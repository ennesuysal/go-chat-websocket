import { Buf } from "./buf"
import { EventEmitter } from "./EventEmitter"
import { keepalive } from "./keepalive"
import { console, document } from "./env"
import * as protocol from "./protocol"
import * as utf8 from "./utf8"

var gotalk = exports;
export default exports;

var txt = protocol.text
var bin = protocol.binary

gotalk.version = VERSION // VERSION defined by compiler
gotalk.protocol = protocol
gotalk.Buf = Buf
gotalk.developmentMode = false
gotalk.defaultResponderAddress = ""

// this is set by initWebDocumentDeps() to the default (inferred) value of
// gotalk.defaultResponderAddress and used to show warning messages.
var builtinDefaultResponderAddress = ""

// scriptUrl is the gotalk.js script URL, updated by init()
var scriptUrl = { wsproto: "", proto: "", host: "", path: "" }

function noop(){}

// run at script initialization (end of this file)
function init() {
  document && initWebDocumentDeps()

  gotalk.developmentMode = hostnameIsLocal(scriptUrl.host)
}

function initWebDocumentDeps() {
  // init stuff that depends on HTML "document"
  var s = document.currentScript.src
  if (!s) {
    return
  }

  var a = s.indexOf('://') + 3
  if (a == 2) {
    return
  }
  scriptUrl.proto = s.substr(0, a - 2) // e.g. "http:"
  var b = s.indexOf('/', a)
  if (b == -1) {
    return
  }
  scriptUrl.wsproto = scriptUrl.proto == "https:" ? "wss://" : "ws://"

  scriptUrl.host = s.substring(a, b)  // e.g. localhost:1234
  s = s.substr(b)
  a = s.lastIndexOf('?')
  if (a != -1) {
    // trim away query string
    s = s.substr(0, a)
  }

  scriptUrl.path = s.substring(s.indexOf('/'), s.lastIndexOf('/') + 1)
  gotalk.defaultResponderAddress = scriptUrl.wsproto + scriptUrl.host + scriptUrl.path
  builtinDefaultResponderAddress = gotalk.defaultResponderAddress
}

function hostnameIsLocal(hostname) {
  var h = hostname
  var i = h.lastIndexOf(":")
  if (i != -1) {
    // strip port
    h = h.substr(0, i)
  }
  i = h.lastIndexOf(".")
  return (
    i == -1 ? h == "localhost" : // note: no ipv6 on purpose
       h == "127.0.0.1"
    || h.substr(i) == ".local"  // e.g. "robins-mac.local"
  )
}

function logDevWarning(/*...*/) {
  gotalk.developmentMode && console.warn.apply(console, Array.prototype.slice.call(arguments))
}

function decodeJSON(v) {
  if (!v || v.length == 0) {
    return null
  }
  if (typeof v != "string") {
    v = utf8.decode(v)
  }
  try {
    return JSON.parse(v);
  } catch (err) {
    logDevWarning("[gotalk] ignoring invalid json", v)
  }
}


// ===============================================================================================

function Sock(handlers, proto) { return Object.create(Sock.prototype, {
  // Public properties
  handlers:      {value:handlers, enumerable:true},
  protocol:      {
    value:      proto || (Buf ? protocol.binary : protocol.text),
    enumerable: true,
    writable:   true
  },
  heartbeatInterval: {value: 20 * 1000, enumerable:true, writable:true},

  // Internal
  ws:            {value:null,  writable:true, enumerable:true},
  keepalive:     {value:null,  writable:true, enumerable:true},
  _isOpen:       {value:false, writable:true},

  // Send queue
  _sendq:           {value:[],  writable:true},
  sendBufferLimit:  {value:100, writable:true, enumerable:true},

  // Used for performing requests
  nextOpID:      {value:0,  writable:true},
  nextStreamID:  {value:0,  writable:true},
  pendingRes:    {value:{}, writable:true},
  hasPendingRes: {get:function(){ for (var k in this.pendingRes) { return true; } }},

  // True if end() has been called while there were outstanding responses
  pendingClose:  {value:false, writable:true},
}); }

Sock.prototype = EventEmitter.mixin(Sock.prototype);
exports.Sock = Sock;


function resetSock(s, causedByErr) {
  s.pendingClose = false;
  s.stopSendingHeartbeats();

  if (s.ws) {
    s.ws.onmessage = null;
    s.ws.onerror = null;
    s.ws.onclose = null;
    s.ws = null;
  }

  s.nextOpID = 0;
  if (s.hasPendingRes) {
    var err = causedByErr || new Error('connection closed');
    // TODO: return a RetryResult kind of error instead of just an error
    for (var k in s.pendingRes) {
      s.pendingRes[k](err);
    }
    s.pendingRes = {};
  }
}


var websocketCloseStatus = {
  1000: 'normal',
  1001: 'going away',
  1002: 'protocol error',
  1003: 'unsupported',
  // 1004 is currently unassigned
  1005: 'no status',
  1006: 'abnormal',
  1007: 'inconsistent',
  1008: 'invalid message',
  1009: 'too large',
};

var CLOSE_ERROR = Symbol("CLOSE_ERROR")


function wsCloseStatusMsg(code) {
  var name = websocketCloseStatus[code]
  return '#'+code + (name ? " (" + name + ")" : "")
}


// Adopt a web socket, which should be in an OPEN state
Sock.prototype.adoptWebSocket = function(ws) {
  var s = this;
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error('web socket readyState != OPEN');
  }
  ws.binaryType = 'arraybuffer';
  s.ws = ws;
  ws.onclose = function(ev) {
    var err = ws[CLOSE_ERROR] || null;
    if (!err && ev.code !== 1000) {
      err = new Error('websocket closed: ' + wsCloseStatusMsg(ev.code));
    }
    resetSock(s, err);
    s._connectionStatusChange(false);
    s.emit('close', err);
  };
  ws.onmessage = function(ev) {
    if (!ws._bufferedMessages) ws._bufferedMessages = [];
    ws._bufferedMessages.push(ev.data);
  };
};


Sock.prototype.adopt = function(rwc) {
  if (adopt instanceof WebSocket) {
    return this.adoptWebSocket(rwc);
  } else {
    throw new Error('unsupported transport');
  }
};


Sock.prototype.handshake = function () {
  this.ws.send(this.protocol.versionBuf);
};


Sock.prototype.end = function() {
  // Allow calling twice to "force close" even when there are pending responses
  var s = this;
  if (s.keepalive) {
    s.keepalive.disable();
    s.keepalive = null;
  }
  if (!s.pendingClose && s.hasPendingRes) {
    s.pendingClose = true;
  } else if (s.ws) {
    s.ws.close(1000);
  }
};


Sock.prototype.address = function() {
  var s = this;
  if (s.ws) {
    return s.ws.url;
  }
  return null;
};

// ===============================================================================================
// Reading messages from a connection

var ErrAbnormal = exports.ErrAbnormal = Error("unsupported protocol");
ErrAbnormal.isGotalkProtocolError = true;
ErrAbnormal.code = protocol.ErrorAbnormal;

var ErrUnsupported = exports.ErrUnsupported = Error("unsupported protocol");
ErrUnsupported.isGotalkProtocolError = true;
ErrUnsupported.code = protocol.ErrorUnsupported;

var ErrInvalidMsg = exports.ErrInvalidMsg = Error("invalid protocol message");
ErrInvalidMsg.isGotalkProtocolError = true;
ErrInvalidMsg.code = protocol.ErrorInvalidMsg;

var ErrTimeout = exports.ErrTimeout = Error("timeout");
ErrTimeout.isGotalkProtocolError = true;
ErrTimeout.code = protocol.ErrorTimeout;


Sock.prototype.sendHeartbeat = function (load) {
  var s = this, buf = s.protocol.makeHeartbeatMsg(Math.round(load * protocol.HeartbeatMsgMaxLoad));
  try {
    s.ws.send(buf);
  } catch (err) {
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      err = new Error('socket is closed');
    }
    throw err;
  }
};


Sock.prototype.startSendingHeartbeats = function() {
  var s = this;
  if (s.heartbeatInterval < 10) {
    throw new Error("Sock.heartbeatInterval is too low");
  }
  clearTimeout(s._sendHeartbeatsTimer);
  var send = function() {
    clearTimeout(s._sendHeartbeatsTimer);
    s.sendHeartbeat(0);
    s._sendHeartbeatsTimer = setTimeout(send, s.heartbeatInterval);
  };
  s._sendHeartbeatsTimer = setTimeout(send, 1);
};


Sock.prototype.stopSendingHeartbeats = function() {
  var s = this;
  clearTimeout(s._sendHeartbeatsTimer);
};


Sock.prototype.startReading = function () {
  var s = this, ws = s.ws, msg;  // msg = current message

  function readMsg(ev) {
    msg = typeof ev.data === 'string' ? txt.parseMsg(ev.data) : bin.parseMsg(Buf(ev.data));
    // console.log(
    //   'readMsg:',
    //   typeof ev.data === 'string' ? ev.data : Buf(ev.data).toString(),
    //   'msg:',
    //   msg
    // );
    if (msg.t === protocol.MsgTypeProtocolError) {
      var errcode = msg.size;
      if (errcode === protocol.ErrorAbnormal) {
        ws[CLOSE_ERROR] = ErrAbnormal;
      } else if (errcode === protocol.ErrorUnsupported) {
        ws[CLOSE_ERROR] = ErrUnsupported;
      } else if (errcode === protocol.ErrorTimeout) {
        ws[CLOSE_ERROR] = ErrTimeout;
      } else {
        ws[CLOSE_ERROR] = ErrInvalidMsg;
      }
      ws.close(4000 + errcode);
    } else if (msg.size !== 0 && msg.t !== protocol.MsgTypeHeartbeat) {
      ws.onmessage = readMsgPayload;
    } else {
      s.handleMsg(msg);
      msg = null;
    }
  }

  function readMsgPayload(ev) {
    var b = ev.data;
    ws.onmessage = readMsg;
    s.handleMsg(msg, typeof b === 'string' ? b : Buf(b));
    msg = null;
  }

  function readVersion(ev) {
    var peerVersion = typeof ev.data === 'string' ? txt.parseVersion(ev.data) :
                                                    bin.parseVersion(Buf(ev.data));
    if (peerVersion !== protocol.Version) {
      ws[CLOSE_ERROR] = ErrUnsupported;
      s.closeError(protocol.ErrorUnsupported);
    } else {
      ws.onmessage = readMsg;
      if (s.heartbeatInterval > 0) {
        s.startSendingHeartbeats();
      }
    }
  }

  // We begin by sending our version and reading the remote side's version
  ws.onmessage = readVersion;

  // Any buffered messages?
  if (ws._bufferedMessages) {
    ws._bufferedMessages.forEach(function(data){ ws.onmessage({data:data}); });
    ws._bufferedMessages = null;
  }
};

// ===============================================================================================
// Handling of incoming messages

var msgHandlers = {};

Sock.prototype.handleMsg = function(msg, payload) {
  // console.log('handleMsg:', String.fromCharCode(msg.t), msg, 'payload:', payload);
  var s = this;
  var msgHandler = msgHandlers[msg.t];
  if (!msgHandler) {
    if (s.ws) {
      s.ws[CLOSE_ERROR] = ErrInvalidMsg;
    }
    s.closeError(protocol.ErrorInvalidMsg);
  } else {
    msgHandler.call(s, msg, payload);
  }
};

msgHandlers[protocol.MsgTypeSingleReq] = function (msg, payload) {
  var s = this, handler, result;
  handler = s.handlers.findRequestHandler(msg.name);

  result = function (outbuf) {
    s.sendMsg(protocol.MsgTypeSingleRes, msg.id, null, 0, outbuf);
  };
  result.error = function (err) {
    var errstr = err.message || String(err);
    s.sendMsg(protocol.MsgTypeErrorRes, msg.id, null, 0, errstr);
  };

  if (typeof handler !== 'function') {
    result.error('no such operation "'+msg.name+'"');
  } else {
    try {
      handler(payload, result, msg.name);
    } catch (err) {
      logDevWarning("[gotalk] handler error:", err.stack || (""+err))
      result.error('internal error')
    }
  }
};

function handleRes(msg, payload) {
  var id = msg.id;
  if (typeof id != "string") {
    // then it's a Buf
    id = String.fromCharCode.apply(null, id)
  }
  var s = this, callback = s.pendingRes[id];
  if (msg.t !== protocol.MsgTypeStreamRes || !payload || (payload.length || payload.size) === 0) {
    delete s.pendingRes[id];
    if (s.pendingClose && !s.hasPendingRes) {
      s.end();
    }
  }
  if (typeof callback !== 'function') {
    return; // ignore message
  }
  if (msg.t === protocol.MsgTypeErrorRes) {
    if (typeof payload != "string") {
      payload = utf8.decode(payload)
    }
    callback(new Error(payload), null);
  } else {
    callback(null, payload);
  }
}

msgHandlers[protocol.MsgTypeSingleRes] = handleRes;
msgHandlers[protocol.MsgTypeStreamRes] = handleRes;
msgHandlers[protocol.MsgTypeErrorRes] = handleRes;

msgHandlers[protocol.MsgTypeNotification] = function (msg, payload) {
  var handler = this.handlers.findNotificationHandler(msg.name);
  if (handler) {
    handler(payload, msg.name);
  }
};

msgHandlers[protocol.MsgTypeHeartbeat] = function (msg) {
  this.emit('heartbeat', {time:new Date(msg.size * 1000), load:msg.wait});
};

// ===============================================================================================
// Sending messages

Sock.prototype._connectionStatusChange = function(isOpen) {
  if (this._isOpen == isOpen) {
    return
  }
  this._isOpen = isOpen;
  if (isOpen) {
    flushSendq(this)
  }
}

function sendMsg(s, buf1, buf2) {
  try {
    s.ws.send(buf1);
    if (buf2) {
      s.ws.send(buf2);
    }
  } catch (err) {
    if (!s.ws || s.ws.readyState > WebSocket.OPEN) {
      err = new Error('socket is closed');
      if (sendEnqueue(s, buf1, buf2)) {
        console.warn("gotalk send error: " + err + " (retrying)")
        return
      }
    }
    throw err
  }
}

function flushSendq(s) {
  if (s._sendq.length == 0) {
    return
  }
  var q = s._sendq
  s._sendq = []
  var err, t, i = 0
  for (; i < q.length; i++) {
    t = q[i]
    sendMsg(s, t[0], t[1])
  }
}

function sendEnqueue(s, buf1, buf2) {
  if (s._sendq.length >= s.sendBufferLimit) {
    return false
  }
  s._sendq.push([buf1, buf2])
  return true
}

Sock.prototype.sendMsg = function(t, id, name, wait, payload) {
  var payloadSize = 0
  if (payload) {
    if (typeof payload === 'string' && this.protocol === protocol.binary) {
      payloadSize = utf8.sizeOf(payload)
    } else {
      payloadSize = payload.length || payload.size || 0
    }
    if (payloadSize == 0) {
      payload = null
    }
  }
  var s = this, buf = s.protocol.makeMsg(t, id, name, wait, payloadSize);
  // console.log('sendMsg(',t,id,name,payload,'): protocol.makeMsg =>',
  //   typeof buf === 'string' ? buf : buf.toString());
  if (!s._isOpen) {
    if (!sendEnqueue(s, buf, payload)) {
      throw new Error('socket is closed');
    }
  } else {
    sendMsg(s, buf, payload)
  }
};


Sock.prototype.closeError = function(code) {
  var s = this, buf;
  if (s.ws) {
    try {
      s.ws.send(s.protocol.makeMsg(protocol.MsgTypeProtocolError, null, null, 0, code));
    } catch (e) {}
    s.ws.close(4000 + code);
  }
};

Sock.prototype.notify = function(op, value) {
  var buf = JSON.stringify(value);
  return this.bufferNotify(op, buf);
}

Sock.prototype.bufferNotify = function(name, buf) {
  this.sendMsg(protocol.MsgTypeNotification, null, name, 0, buf);
}

var zeroes = '0000';

Sock.prototype.bufferRequest = function(op, buf, callback) {
  var s = this
  return new Promise(function (resolve, reject) {
    var id = s.nextOpID++;
    if (s.nextOpID === 1679616) {
      // limit for base36 within 4 digits (36^4=1679616)
      s.nextOpID = 0;
    }
    id = id.toString(36);
    id = zeroes.substr(0, 4 - id.length) + id;
    var finalizer = function(err, resp) {
      if (err) { reject(err) } else { resolve(resp) }
      if (callback) { callback(err, resp) }
    }
    s.pendingRes[id] = finalizer
    try {
      s.sendMsg(protocol.MsgTypeSingleReq, id, op, 0, buf);
    } catch (err) {
      delete s.pendingRes[id];
      finalizer(err);
    }
  })
}

Sock.prototype.request = function(op, value, callback) {
  var buf;
  if (value !== undefined) {
    if (callback === undefined && typeof value == "function") {
      // called as: request("op", function...)
      callback = value;
    } else {
      buf = JSON.stringify(value);
    }
  }
  var p = this.bufferRequest(op, buf).then(function (buf) {
    var value = decodeJSON(buf);
    if (callback) { callback(null, value) }
    return value
  })
  if (callback) {
    p = p.catch(function (err) { callback(err) })
  }
  return p
}

Sock.prototype.requestp = Sock.prototype.request
Sock.prototype.bufferRequestp = Sock.prototype.bufferRequest


// ===============================================================================================

// Represents a stream request.
// Response(s) arrive by the "data"(buf) event. When the response is complete, a "end"(error)
// event is emitted, where error is non-empty if the request failed.
var StreamRequest = function(s, op, id) {
  return Object.create(StreamRequest.prototype, {
    s:  {value:s},
    op: {value:op, enumerable:true},
    id: {value:id, enumerable:true},
  });
};

EventEmitter.mixin(StreamRequest.prototype);

StreamRequest.prototype.write = function (buf) {
  if (!this.ended) {
    if (!this.started) {
      this.started = true;
      this.s.sendMsg(protocol.MsgTypeStreamReq, this.id, this.op, 0, buf);
    } else {
      this.s.sendMsg(protocol.MsgTypeStreamReqPart, this.id, null, 0, buf);
    }
    if (!buf || buf.length === 0 || buf.size === 0) {
      this.ended = true;
    }
  }
};

// Finalize the request
StreamRequest.prototype.end = function () {
  this.write(null);
};

Sock.prototype.streamRequest = function(op) {
  var s = this, id = s.nextStreamID++;
  if (s.nextStreamID === 46656) {
    // limit for base36 within 3 digits (36^3=46656)
    s.nextStreamID = 0;
  }
  id = id.toString(36);
  id = '!' + zeroes.substr(0, 3 - id.length) + id;

  var req = StreamRequest(s, op, id);

  s.pendingRes[id] = function (err, buf) {
    if (err) {
      req.emit('end', err);
    } else if (!buf || buf.length === 0) {
      req.emit('end', null);
    } else {
      req.emit('data', buf);
    }
  };

  return req;
};


// ===============================================================================================

function Handlers() { return Object.create(Handlers.prototype, {
  reqHandlers:         {value:{}},
  reqFallbackHandler:  {value:null, writable:true},
  noteHandlers:        {value:{}},
  noteFallbackHandler: {value:null, writable:true}
}); }
exports.Handlers = Handlers;


Handlers.prototype.handleBufferRequest = function(op, handler) {
  if (!op) {
    this.reqFallbackHandler = handler;
  } else {
    this.reqHandlers[op] = handler;
  }
};

Handlers.prototype.handleRequest = function(op, handler) {
  return this.handleBufferRequest(op, function (buf, result, op) {
    var resultWrapper = function(value) {
      return result(JSON.stringify(value));
    };
    resultWrapper.error = result.error;
    var value = decodeJSON(buf);
    handler(value, resultWrapper, op);
  });
};

Handlers.prototype.handleBufferNotification = function(name, handler) {
  if (!name) {
    this.noteFallbackHandler = handler;
  } else {
    this.noteHandlers[name] = handler;
  }
};

Handlers.prototype.handleNotification = function(name, handler) {
  this.handleBufferNotification(name, function (buf, name) {
    handler(decodeJSON(buf), name);
  });
};

Handlers.prototype.findRequestHandler = function(op) {
  var handler = this.reqHandlers[op];
  return handler || this.reqFallbackHandler;
};

Handlers.prototype.findNotificationHandler = function(name) {
  var handler = this.noteHandlers[name];
  return handler || this.noteFallbackHandler;
};

// TODO: Implement support for handling stream requests

// ===============================================================================================


var reportedOpenError = false

function openWebSocket(s, addr, callback) {
  var ws;
  try {
    ws = new WebSocket(addr);
    ws.binaryType = 'arraybuffer';
    ws.onclose = function (ev) {
      if (gotalk.developmentMode &&
          !reportedOpenError &&
          builtinDefaultResponderAddress == gotalk.defaultResponderAddress
      ) {
        reportedOpenError = true
        logDevWarning(
          'gotalk connection failed with code ' + wsCloseStatusMsg(ev.code) + '.' +
          ' If you are serving gotalk.js yourself,' +
          ' remember to set gotalk.defaultResponderAddress to the gotalk websocket endpoint.'
        )
      }
      var err = new Error('connection failed: ' + wsCloseStatusMsg(ev.code));
      if (callback) callback(err);
    };
    ws.onopen = function(ev) {
      ws.onerror = undefined;
      s.adoptWebSocket(ws);
      s.handshake();
      s._connectionStatusChange(true);
      if (callback) callback(null, s);
      s.emit('open', s);
      s.startReading();
    };
    ws.onmessage = function(ev) {
      if (!ws._bufferedMessages) ws._bufferedMessages = [];
      ws._bufferedMessages.push(ev.data);
    };
  } catch (err) {
    logDevWarning("[gotalk] WebSocket init error:", err.stack || (""+err))
    s._connectionStatusChange(false);
    if (callback) callback(err);
    s.emit('close', err);
  }
}


function anyProtoToWsProto(proto) {
  return proto == "https:" ? "wss://" : "ws://"
}


function absWsAddr(addr) {
  if (!addr) {
    addr = gotalk.defaultResponderAddress
  }

  var start = addr.substr(0,4)
  if (start != "ws:/" && start != "wss:") {
    // addr does not specify protocol
    if (scriptUrl.proto) {
      if (addr[0] == "/") {
        if (addr[1] == "/") {
          // addr specifices "//host/path"
          addr = scriptUrl.wsproto + addr
        } else {
          // addr specifices absolute "/path"
          addr = scriptUrl.wsproto + scriptUrl.host + addr
        }
      } else {
        // addr specifices relative "path"
        addr = scriptUrl.wsproto + scriptUrl.host + "/" + addr
      }
    }
  }

  if (!addr) {
    throw new Error('address not specified')
  }

  return addr
}


Sock.prototype.open = function(addr, callback) {
  var s = this;
  if (!callback && typeof addr == 'function') {
    callback = addr;
    addr = null;
  }
  openWebSocket(s, absWsAddr(addr), callback);
  return s;
};


// Open a connection to a gotalk responder.
//
// open(addr string[, onConnect(Error, Sock)]) -> Sock
//   Connect to gotalk responder at `addr`
//
// open([onConnect(Error, Sock)]) -> Sock
//   Connect to default gotalk responder.
//   Throws an error if `gotalk.defaultResponderAddress` isn't defined.
//
gotalk.open = function(addr, onConnect, handlers, proto) {
  return Sock(handlers || gotalk.defaultHandlers, proto).open(addr, onConnect);
};


// If `addr` is not provided, `gotalk.defaultResponderAddress` is used instead.
Sock.prototype.openKeepAlive = function(addr) {
  var s = this;
  if (s.keepalive) {
    s.keepalive.disable();
  }
  s.keepalive = keepalive(s, addr);
  s.keepalive.enable();
  return s;
};


// Returns a new Sock with a persistent connection to a gotalk responder.
// The Connection is automatically kept alive (by reconnecting) until Sock.end() is called.
// If `addr` is not provided, `gotalk.defaultResponderAddress` is used instead.
gotalk.connection = function(addr, handlers, proto) {
  return Sock(handlers || gotalk.defaultHandlers, proto).openKeepAlive(addr);
};


gotalk.defaultHandlers = Handlers();

gotalk.handleBufferRequest = function(op, handler) {
  return gotalk.defaultHandlers.handleBufferRequest(op, handler);
};

gotalk.handle = function(op, handler) {
  return gotalk.defaultHandlers.handleRequest(op, handler);
};

gotalk.handleBufferNotification = function (name, handler) {
  return gotalk.defaultHandlers.handleBufferNotification(name, handler);
};

gotalk.handleNotification = function (name, handler) {
  return gotalk.defaultHandlers.handleNotification(name, handler);
};


init()
