export default gotalk

declare namespace gotalk {

type int = number

// connection() creates a persistent (keep-alive) connection to a gotalk responder.
// If `addr` is not provided, `defaultResponderAddress` is used.
// Equivalent to `Sock(handlers, proto).openKeepAlive(addr)`
function connection<T>(
  addr :string | undefined,
  handlers :Handlers<T> | undefined,
  proto? :Protocol<T>
) :Sock<T>
function connection(addr? :string) :Sock<Uint8Array>

// Open a connection to a gotalk responder.
// If `addr` is not provided, `defaultResponderAddress` is used.
// Equivalent to `Sock(handlers, proto).open(addr, onconnect)`
function open<T>(
  addr       :string | undefined,
  onconnect  :((e:Error,s:Sock<Uint8Array>)=>void) | undefined,
  handlers   :Handlers<T> | undefined,
  proto?     :Protocol<T>
) :Sock<T>
function open(
  addr?      :string | undefined,
  onconnect? :((e:Error,s:Sock<Uint8Array>)=>void) | undefined,
) :Sock<Uint8Array>

// Default `Handlers` utilized by the module-level `handle*` functions
// The type is Handlers<Uint8Array> by default.
var defaultHandlers :Handlers<Uint8Array>|Handlers<string>

// Default web socket address to connect to, when no address is provided to open() or connection().
// When the gotalk js library is served from the gotalk server, this is prepopulated with the
// correct gotalk web socket address.
// If you serve the gotalk library yourself, set this to the gotalk web socket server before
// calling open() or connect() without an address.
// Examples values:
//   ws://example.com/gotalk     // http-based (unencrypted) absolute address
//   wss://example.com/gotalk    // https-based (encrypted) absolute address
//   //example.com/gotalk        // protocol matches document, with absolute address
//   /gotalk                     // protocol and host matches document, with absolute path
//
var defaultResponderAddress :string

// If set to true, some helpful messages may be logged to the console.
// The initial value is true when gotalk is served in a web browser over localhost, else its false.
var developmentMode :boolean

// Version of the gotalk JavaScript library. Example: "1.2.3".
// For what version of the Gotalk protocol this library supports, see protocol.Version.
const version :string

// Sock creates a socket
function Sock<T>(handlers :Handlers<T>, proto? :Protocol<T>) :Sock<T>


// Convenience "shortcuts" to `defaultHandlers`
//
// Register a handler for an operation `op`. If `op` is the empty string the
// handler will be registered as a "fallback" handler, meaning that if there are
// no handlers registered for request "x", the fallback handler will be invoked.
function handleRequest<In=any,Out=any>(
  op :string,
  h :(data :In, resolve :Resolver<Out>, op :string)=>void,
) :void
function handleBufferRequest<T=Uint8Array>(
  op :string,
  h :(data :T, resolve :Resolver<T>, op :string)=>void,
) :void
//
// Register a handler for notification `name`. Just as with request handlers,
// registering a handler for the empty string means it's registered as the fallback handler.
function handleNotification<In=any>(
  name :string,
  h :(data :In, name :string)=>void,
) :void
function handleBufferNotification<T=Uint8Array>(
  name :string,
  h :(data :T, name :string)=>void,
) :void


interface SockEventMap<T> {
  "open"      :Sock<T>    // connection is open
  "close"     :Error|null // connection is closed. Arg is non-null if closed because of error.
  "heartbeat" :{time: Date, load: number}
}


interface Sock<T> extends EventEmitter<SockEventMap<T>> {
  readonly ws       :WebSocket    // underlying connection
  readonly handlers :Handlers<T>
  readonly protocol :Protocol<T>

  // Open a connection to a gotalk responder.
  // If `addr` is not provided, `defaultResponderAddress` is used.
  open(addr :string, cb? :(e:Error,s:this)=>void) :this
  open(cb? :(e:Error,s:this)=>void) :this

  // Start a persistent (keep-alive) connection to a gotalk responder.
  // If `addr` is not provided, `defaultResponderAddress` is used.
  // Because the "open" step is abstracted away, this function does not accept any "open callback".
  // You should listen to the "open" and "close" events instead.
  // The Sock will stay connected, and reconnect as needed, until you call `end()`.
  openKeepAlive(addr? :string) :this

  // Send request for operation `op` with `value` as the payload, using JSON for encoding.
  // The cb argument is optional and here for backwards compatibility with an older API.
  request<R=any>(op :string, value :any, cb? :(e :Error, result :R)=>void) :Promise<R>

  // Send a request for operation `op` with raw-buffer `buf` as the payload,
  // if any. The type of result depends on the protocol used by the server
  // — a server sending a "text" frame means the result is a string, while a
  // server sending a "binary" frame causes the result to be a Uint8Array.
  // The cb argument is optional and here for backwards compatibility with an older API.
  bufferRequest(op :string, buf :T|null, cb? :(e :Error, result :T)=>void) :Promise<T>

  // Create a StreamRequest for operation `op` which is ready to be used.
  // Note that calling this method does not send any data — sending the request
  // and reading the response is performed by using the returned object.
  streamRequest(op :string) :StreamRequest<T>

  // Send notification `name` with raw-buffer `buf` as the payload, if any.
  bufferNotify(name :string, buf :T|null) :void

  // Send notification `name` with `value`, using JSON for encoding.
  notify(name :string, value :any) :void

  // Send a heartbeat message with `load` which should be in the range [0-1]
  sendHeartbeat(load :number) :void

  // Returns a string representing the address to which the socket is connected.
  address() :string|null

  // Adopt a connection capable of being received from, written to and closed.
  // It should be in an "OPEN" ready-state.
  // You need to call `handshake` followed by `startReading` after adopting a previosuly
  // unadopted connection.
  // Throws an error if the provided connection type is not supported.
  // Currently only supports WebSocket.
  adopt(ws :WebSocket) :void

  // Perform protocol handshake.
  handshake() :void

  // Schedule reading from the underlying connection. Should only be called
  // once per connection.
  startReading() :void

  // Close the socket. If there are any outstanding responses from pending
  // requests, the socket will close when all pending requests has finished.
  // If you call this function a second time, the socket will close immediately,
  // even if there are outstanding responses.
  end() :void

  // sendBufferLimit configures how many messages may be queued to be sent when
  // the socket is not connected.
  // A value of 0 causes send buffering to be disabled.
  // Added in gotalk.js v1.2.0
  sendBufferLimit :number

  /** @DEPRECATED use request */
  requestp<R=any>(op :string, value :any) :Promise<R>
  /** @DEPRECATED use bufferRequest */
  bufferRequestp(op :string, buf :T|null) :Promise<T>
}


interface Handlers<T> {
  // Register a handler for an operation `op`. If `op` is the empty string the
  // handler will be registered as a "fallback" handler, meaning that if there are
  // no handlers registered for request "x", the fallback handler will be invoked.
  handleRequest<In=any,Out=any>(
    op :string,
    h :(data :In, resolve :Resolver<Out>, op :string)=>void,
  ) :void
  handleBufferRequest(op :string, h :(data :T, resolve :Resolver<T>, op :string)=>void) :void

  // Register a handler for notification `name`. Just as with request handlers,
  // registering a handler for the empty string means it's registered as the fallback handler.
  handleNotification<In=any>(name :string, h :(data :In, name :string)=>void) :void
  handleBufferNotification(name :string, h :(data :T, name :string)=>void) :void

  // Find request and notification handlers
  findRequestHandler(op :string) :((data:T,r:Resolver<T>,op:string)=>void) | null
  findNotificationHandler(name :string) :((data:T,name:string)=>void) | null
}

// Create a new Handlers object
function Handlers<T>() :Handlers<T>

interface Resolver<T> {
  (value :T) :void
  error(e :Error) :void
}

interface StreamRequestEventMap<T> {
  "data"      :T           // response chunk received
  "close"     :Error|null  // connection has closed. Arg is non-null if closed because of error.
}

interface StreamRequest<T> extends EventEmitter<StreamRequestEventMap<T>> {
  readonly op :string  // Operation name
  readonly id :string  // Request ID

  // Write a request chunk. Writing an empty `buf` or null causes the request to end,
  // meaning no more chunks can be written. Calling `write()` or `end()` after the
  // request has finished has no effect.
  write(buf :T) :void

  // End the request, indicating to the responder that it will not receive more payloads.
  end() :void
}

// Create a StreamRequest operating on a certain socket `s`.
// This is a low-level function. See `Sock.streamRequest()` for a higher-level function,
// which sets up response tracking, generates a request ID, etc.
function StreamRequest<T>(s :Sock<T>, op :string, id :string) :StreamRequest<T>


interface Protocol<T> {
  // Produce a fixed-digit number for integer `n`
  makeFixnum(n :int, digits :int) :T

  // protocol.Version as a T
  versionBuf :T

  // Parse value as protocol version which is expected to have a length of 2.
  parseVersion(data :T) :int

  // Parses a message from a T, which must not including any payload data.
  parseMsg(data :T) :{t:int, id:T, name:string, size:int} | null

  // Create a T representing a message, not including any payload data.
  makeMsg(t :int, id :T|string, name :string, payloadSize :int) :T
}


namespace protocol {
  // The version of the protocol implementation
  const Version = 1

  // Message type constants
  const MsgTypeSingleReq     = 0x72 // byte('r')
  const MsgTypeStreamReq     = 0x73 // byte('s')
  const MsgTypeStreamReqPart = 0x70 // byte('p')
  const MsgTypeSingleRes     = 0x52 // byte('R')
  const MsgTypeStreamRes     = 0x53 // byte('S')
  const MsgTypeErrorRes      = 0x45 // byte('E')
  const MsgTypeRetryRes      = 0x65 // byte('e')
  const MsgTypeNotification  = 0x6E // byte('n')
  const MsgTypeHeartbeat     = 0x68 // byte('h')
  const MsgTypeProtocolError = 0x66 // byte('f')

  // ProtocolError codes
  const ErrorAbnormal    = 0
  const ErrorUnsupported = 1
  const ErrorInvalidMsg  = 2
  const ErrorTimeout     = 3

  // Maximum value of a heartbeat's "load"
  const HeartbeatMsgMaxLoad = 0xffff

  // Implements a byte-binary version of the gotalk protocol
  const binary :Protocol<Uint8Array>

  // Implements a JavaScript text version of the gotalk protocol
  const text :Protocol<string>
}

type EventHandler<T=any> = (data :T)=>void

interface EventEmitter<EventMap = {[k:string]:any}> {
  on<K extends keyof EventMap>(e :K, handler :EventHandler<EventMap[K]>) :this
  once<K extends keyof EventMap>(e :K, handler :EventHandler<EventMap[K]>) :this
  addListener<K extends keyof EventMap>(e :K, handler :EventHandler<EventMap[K]>) :this
  removeListener<K extends keyof EventMap>(e :K, handler :EventHandler<EventMap[K]>) :void
  removeListeners<K extends keyof EventMap>(e :K) :void
  removeAllListeners() :void
  emit<K extends keyof EventMap>(e :K, data? :EventMap[K]) :void
}

const EventEmitter : {
  mixin<T>(obj :T) :(T & EventEmitter)
}

} // namespace gotalk
