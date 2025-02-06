const ip = "https://YOUR_IP:3000"
const socket = io(ip)
let peerConnection
let localStream = null
let currentPartner = null
let username = null
let partnerUsername = null
let offer = false

const pages = {
    name: document.getElementById('name-page'),
    waiting: document.getElementById('waiting-page'),
    video: document.getElementById('video-page')
}

document.getElementById("username").addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        startChat()
    }
})

document.getElementById("message-input").addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        sendMessage()
    }
})

function mute() {
    document.getElementById("remoteVideo").muted = !document.getElementById("remoteVideo").muted
}

function startChat() {
    username = document.getElementById('username').value.trim()
    if (!username) return alert('Please enter a name')
    document.getElementById('display-name').textContent = username
    document.getElementById('local-username').textContent = username
    pages.name.style.display = 'none'
    pages.waiting.style.display = 'block'
    startMediaConnection(username)
}

async function startMediaConnection(username) {
    console.log("video connected");
    await fetch(ip+'/api/users', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: username,
        })
    }).then(() => console.log("user saved"))
    .catch(error => console.error('Error saving message:', error))
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        document.getElementById('localVideo').srcObject = localStream
        setupSocketConnection(username)
    } catch (error) {
        alert('Error accessing media devices: ' + error.message)
    }
}

async function setupSocketConnection(username) {
    socket.emit('register', username)

    socket.on("waiting", () => {
        offer = true
    })

    socket.on("skipped", () => {
        peerConnection = peerConnection.close()
        currentPartner = null
        partnerUsername = null
        pages.video.style.display = 'none'
        pages.waiting.style.display = 'block'
        document.getElementById("status").innerHTML = "You got skipped!"
        socket.emit("register", username)
    })

    socket.on('partnerFound', (partner) => {
        console.log("partner found: " + partner.username)
        pages.waiting.style.display = 'none'
        pages.video.style.display = 'block'
        document.getElementById('remote-username').textContent = partner.username
        currentPartner = partner.id
        partnerUsername = partner.username
        setupPeerConnection(partner.id)
    })

    socket.on('message', async (message) => {
        appendMessage(message.sender, message.text)
        await fetch(ip+'/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender: message.sender,
                receiver: username,
                message: message.text
            })
        }).catch(error => console.error('Error saving message:', error))
    })

    socket.on('offer', async (offer) => {
        console.log('Received offer:', offer)
        console.log('Current state:', peerConnection.signalingState)
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
            console.log('Remote description (offer) set successfully')
    
            const answer = await peerConnection.createAnswer()
            console.log('Created answer:', answer)
            await peerConnection.setLocalDescription(answer)
    
            socket.emit('answer', peerConnection.localDescription, currentPartner)
        } catch (error) {
            console.error('Error handling offer:', error)
        }
    })

    socket.on('answer', async (answer) => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
            await fetch(ip+'/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user1: partnerUsername,
                    user2: username,
                })
            }).then(() => console.log("room saved"))
            .catch(error => console.error('Error saving message:', error))
            socket.emit("paired", currentPartner)
        } catch (error) {
            console.error('Error setting remote description (answer):', error)
        }
    })

    socket.on('candidate', async (candidate) => {
        try {
            await peerConnection.addIceCandidate(candidate)
        } catch (e) {
            console.error('Error adding ICE candidate:', e)
        }
    })
    socket.on('partnerDisconnected', () => {
        peerConnection.close()
        currentPartner = null
        partnerUsername = null
        socket.emit("addToWaitingList", username)
        offer = true
        pages.video.style.display = 'none'
        pages.waiting.style.display = 'block'
        document.getElementById("status").innerHTML = "Your partner disconnected!"
    })
}

let remote = null
function setupPeerConnection(partnerId) {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    peerConnection = new RTCPeerConnection(configuration)

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream)
    })
    
    remote = new MediaStream()
    document.getElementById('remoteVideo').srcObject = remote

    peerConnection.addEventListener('track', e => {
        e.streams[0].getTracks().forEach(track => {
            remote.addTrack(track, remote)
        })
    })
    
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('candidate', event.candidate, partnerId)
        }
    }

    if (offer) {
        createOffer(partnerId)
    }
}

async function createOffer(partnerId) {
    try {
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        socket.emit('offer', peerConnection.localDescription, partnerId)
    } catch (error) {
        console.error('Error creating/setting offer:', error)
    }
}

function sendMessage() {
    const input = document.getElementById('message-input')
    const text = input.value.trim()
    if (!text) return
    
    socket.emit('sendMessage', { text, to: currentPartner })
    appendMessage('You', text)
    input.value = ''
}

function appendMessage(sender, text) {
    const chatBox = document.getElementById('chat-box')
    const messageDiv = document.createElement('div')
    messageDiv.innerHTML = `<strong>${sender}:</strong> ${text}`
    chatBox.appendChild(messageDiv)
    chatBox.scrollTop = chatBox.scrollHeight
}

function skip() {
    peerConnection.close()
    socket.emit("addToWaitingList", username)
    socket.emit("skipped", currentPartner)
    currentPartner = null
    partnerUsername = null
    offer = true
    document.getElementById("status").innerHTML = "You skipped!"
    pages.video.style.display = 'none'
    pages.waiting.style.display = 'block'
}