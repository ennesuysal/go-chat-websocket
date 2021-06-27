let c = gotalk.connection("localhost:1234/gotalk/")
			.on('open', async() => log(`connection opened\r\n`))
			.on('close', function(reason)
				{
					log(`connection closed (reason: ${reason})`);
					var x = document.getElementById("rcv")
					var length = x.options.length;
					for (i = length-1; i >= 0; i--) {
					  x.options[i] = null;
					}
				})
let token = null
let res = null
let username = null

gotalk.handleNotification('isOnline', function (u) {
	var x = document.getElementById("rcv");
	var flag = 0
	var length = x.options.length;
	for (i = length-1; i >= 0; i--) {
	  if(x.options[i].value == u) {
	  	flag = 1
	  	break
	  } 
	}

	if(flag == 0) {
		var option = document.createElement("option");
		option.text = u
		option.value = u
		x.add(option);
	}

	log(u+" is online.")
})

gotalk.handleNotification('hasLeft', function (m) {
	var x = document.getElementById("rcv")
	var length = x.options.length
	for (i = length-1; i >= 0; i--) {
	  if(x.options[i].value == m) {
	  	x.remove(i)
	  	break
	  } 
	}

	log(m+" has left.")
})

gotalk.handleNotification('newMsg', function (m) {
	log(m["sender"]+": "+m["text"])
})

function log(message) {
	document.body.appendChild(document.createTextNode(message))
	document.body.appendChild(document.createElement("br"));
}

async function getOnlines() {	
	let res = await c.requestp('online', {"token": token})
	var x = document.getElementById("rcv");
	var flag = 0
	res["users"].forEach(function(item, index){
		flag = 0
		var length = x.options.length
		for (i = length-1; i >= 0; i--) {
		  if(x.options[i].value == item["username"]) {
		  	flag = 1
		  	break
		  } 
		}
		if(flag == 0)
		{
			var option = document.createElement("option");
			option.text = item["username"];
			option.value = item["username"];
			x.add(option);
		}
	})
}

async function sendMessage() {	
	var msg = document.getElementById("msg").value
	var rcv = document.getElementById("rcv").value
	let res = await c.requestp('sendMsg', {"text": msg, "token": token, "rcv": rcv})
	log(username+": "+msg)
	document.getElementById("msg").value = ""
}

async function logIn() {
	var name = document.getElementById("name").value
	var surname = document.getElementById("surname").value
	username = document.getElementById("username").value
	let res = await c.requestp('login', {"name": name, "surname": surname, "username": username})
	token = res["token"]
	getOnlines()
	getLastMessages()
}

async function getLastMessages() {
	let res = await c.requestp('getMsgs', {"token": token})
	res.forEach(function(item, index){
		log(item["sender"]+": "+item["text"])
	})
}