const express = require('express')
const socketio = require('socket.io')
const https = require('https')
const fs = require('fs')
const ip = "https://192.168.138.25:3001"

const key = fs.readFileSync('cert.key')
const cert = fs.readFileSync('cert.crt')

const app = express()
const server = https.createServer({key, cert}, app)
const io = socketio(server,{
    cors: {
        origin: [
            "https://localhost",
            ip,
        ],
        methods: ["GET", "POST"]
    }
})

app.use(express.static('public'))
app.use(express.json())

app.post('/api/messages', async (req, res) => {
    try {
        const { sender, receiver, message } = req.body
        const chatMessage = new ChatMessage({ username, message })
        await chatMessage.save()
        res.status(201).send("message saved")
    } catch (error) {
        res.status(500).send({ error: 'Failed to save message' })
    }
})

app.post('/api/rooms', async (req, res) => {
    try {
        const { user1, user2 } = req.body
        const room = new Room({ user1, user2 })
        await room.save()
        res.status(201).send("room saved")
    } catch (error) {
        res.status(500).send({ error: 'Failed to create room' })
    }
})
app.post('/api/users', async (req, res) => {
    try {
        const { username } = req.body
        const user = new User({ username })
        await user.save()
        res.status(201).send("user saved")
    } catch (error) {
        res.status(500).send({ error: 'Failed to create room' })
    }
})

const mongoose = require('mongoose')

mongoose.connect('mongodb://localhost:27017/omegle', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB')
}).catch((err) => {
    console.error('Error connecting to MongoDB', err)
})

const chatSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
})
const ChatMessage = mongoose.model('ChatMessage', chatSchema)
const roomSchema = new mongoose.Schema({
    user1: String,
    user2: String,
    createdAt: { type: Date, default: Date.now }
})
const Room = mongoose.model('Room', roomSchema)
const userSchema = new mongoose.Schema({
    username: String,
    createdAt: { type: Date, default: Date.now }
})
const User = mongoose.model('User', userSchema)

let waitingUsers = []
let pairs = []
let skipped = new Map()
let sockets = new Map()

io.on('connection', (socket) => {
    let currentUser = null

    socket.on('register', (username) => {
        currentUser = {
            id: socket.id,
            username,
        }
        sockets.set(socket.id, socket)
        found = false
        for(let i = 0; i < waitingUsers.length; i++) {
            if(!skipped.has(socket.id) || !skipped.get(socket.id).includes(waitingUsers[i].id)) {
                const partner = waitingUsers[i]
                waitingUsers.splice(i, 1)
                io.to(partner.id).emit('partnerFound', currentUser)
                socket.emit('partnerFound', partner)
                found = true
                break
            }  
        }
        if (!found) {
            waitingUsers.push(currentUser)
            socket.emit("waiting")
        }
    })

    socket.on("findPartner", () => {
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.pop()
            io.to(partner.id).emit('partnerFound', currentUser)
            socket.emit('partnerFound', partner)            
        } else {
            waitingUsers.push(currentUser)
            socket.emit("waiting")
        }
    })

    socket.on("skipped", (partnerid) => {
        pairs = pairs.filter(pair => pair.socketid1 !== socket.id && pair.socketid2 !== socket.id)
        if (skipped.has(partnerid)) {
            skipped.get(partnerid).push(socket.id)
        } else {
            skipped.set(partnerid, [socket.id])
        }
        if (skipped.has(socket.id)) {
            skipped.get(socket.id).push(partnerid)
        } else {
            skipped.set(socket.id, [partnerid])
        }
        io.to(partnerid).emit("skipped")
    })

    socket.on('sendMessage', ({ text, to }) => {
        io.to(to).emit('message', {
            sender: currentUser.username,
            text
        })
    })

    socket.on('offer', (offer, partnerId) => {
        io.to(partnerId).emit('offer', offer)
    })

    socket.on('answer', (answer, partnerId) => {
        io.to(partnerId).emit('answer', answer)
    })

    socket.on('candidate', (candidate, partnerId) => {
        io.to(partnerId).emit('candidate', candidate)
    })

    socket.on('paired', (partnerid) => {
        pairs.push({socketid1: socket.id, socketid2: partnerid})
    })

    socket.on('addToWaitingList', (username) => {
        waitingUsers.push({id: socket.id,username: username})
    })

    socket.on('disconnect', () => {
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id)
        pairs.forEach(pair => {
            if(pair.socketid1 === socket.id || pair.socketid2 === socket.id) {
                sockets.delete(socket.id)
                if (pair.socketid1 === socket.id) {
                    socket.to(pair.socketid2).emit("partnerDisconnected")
                } else {
                    socket.to(pair.socketid1).emit("partnerDisconnected")
                }
            }
        });
    })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))

