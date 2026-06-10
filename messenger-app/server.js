const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.json());
app.use(express.static('public'));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
app.use('/uploads', express.static('uploads'));
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });
const dbPath = process.env.DATABASE_PATH || 'messenger.db';
const db = new sqlite3.Database(dbPath);
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function generateGroupCode() {
    return 'G' + Math.floor(10000 + Math.random() * 90000).toString();
}
db.serialize(() => {
    db.run(`DROP TABLE IF EXISTS private_messages`);
    db.run(`DROP TABLE IF EXISTS group_messages`);
    db.run(`DROP TABLE IF EXISTS group_members`);
    db.run(`DROP TABLE IF EXISTS groups`);
    db.run(`DROP TABLE IF EXISTS friend_requests`);
    db.run(`DROP TABLE IF EXISTS contacts`);
    db.run(`DROP TABLE IF EXISTS users`);   
    db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        name TEXT,
        code TEXT UNIQUE,
        bio TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        online INTEGER DEFAULT 0,
        last_seen DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER,
        to_id INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_id, to_id)
    )`);
    db.run(`CREATE TABLE contacts (
        user_id INTEGER,
        contact_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, contact_id)
    )`);
    db.run(`CREATE TABLE groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        code TEXT UNIQUE,
        avatar TEXT,
        bio TEXT,
        owner_id INTEGER,
        is_private INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE group_members (
        group_id INTEGER,
        user_id INTEGER,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(group_id, user_id)
    )`);
    db.run(`CREATE TABLE group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER,
        from_id INTEGER,
        text TEXT,
        file TEXT,
        reply_to INTEGER,
        deleted INTEGER DEFAULT 0,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE private_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER,
        to_id INTEGER,
        text TEXT,
        file TEXT,
        reply_to INTEGER,
        deleted_by_sender INTEGER DEFAULT 0,
        deleted_by_receiver INTEGER DEFAULT 0,
        self_destruct INTEGER DEFAULT 0,
        expires_at DATETIME,
        is_read INTEGER DEFAULT 0,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('✅ دیتابیس ساخته شد');
});
app.post('/register', (req, res) => {
    const { username, password, name } = req.body;
    if (!username || !password || !name) {
        return res.json({ error: 'همه فیلدها را پر کنید' });
    } 
    const hash = bcrypt.hashSync(password, 10);
    let code = generateCode();
    db.run(`INSERT INTO users (username, password, name, code) VALUES (?, ?, ?, ?)`,
        [username, hash, name, code],
        function(err) {
            if (err) {
                res.json({ error: 'کلمه عبور تکراری است' });
            } else {
                res.json({ success: true, code: code, userId: this.lastID });
            }
        });
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.json({ error: 'کلمه عبور یا رمز عبور اشتباه است' });
        }
        db.run(`UPDATE users SET online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                code: user.code,
                bio: user.bio || '',
                avatar: user.avatar || ''
            }
        });
    });
});
app.get('/search-users', (req, res) => {
    const q = req.query.q;
    const userId = req.query.userId;
    if (!q || q.length < 2) {
        return res.json([]);
    }
    db.all(`SELECT id, name, username, code, bio, online 
            FROM users 
            WHERE (name LIKE ? OR username LIKE ? OR code LIKE ?) AND id != ?
            LIMIT 20`,
        [`%${q}%`, `%${q}%`, `%${q}%`, userId], (err, users) => {
            res.json(users || []);
        });
});
app.get('/find-by-code', (req, res) => {
    const code = req.query.code;
    db.get(`SELECT id, name, username, code, bio, online FROM users WHERE code = ?`, [code], (err, user) => {
        if (!user) {
            res.json({ error: 'کاربری با این کد یافت نشد' });
        } else {
            res.json(user);
        }
    });
});
app.get('/user-profile/:userId', (req, res) => {
    db.get(`SELECT id, name, username, code, bio, avatar, online, last_seen, created_at 
            FROM users WHERE id = ?`, [req.params.userId], (err, user) => {
        if (!user) {
            res.json({ error: 'کاربر یافت نشد' });
        } else {
            res.json(user);
        }
    });
});
app.post('/update-profile', (req, res) => {
    const { userId, name, bio, avatar } = req.body;
    
    db.run(`UPDATE users SET name = ?, bio = ?, avatar = ? WHERE id = ?`,
        [name, bio || '', avatar || '', userId], (err) => {
            if (err) {
                res.json({ error: 'خطا در بروزرسانی' });
            } else {
                res.json({ success: true });
            }
        });
});
app.post('/send-request', (req, res) => {
    const { fromId, toCode, fromName } = req.body;
    
    db.get(`SELECT id FROM users WHERE code = ?`, [toCode], (err, target) => {
        if (!target) {
            return res.json({ error: 'کاربری با این کد یافت نشد' });
        }
        if (target.id == fromId) {
            return res.json({ error: 'نمی‌توانید به خودتان درخواست دهید' });
        }
        db.get(`SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ?`, 
            [fromId, target.id], (err, existing) => {
            if (existing) {
                return res.json({ error: 'درخواست قبلاً ارسال شده است' });
            }
            db.get(`SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?`,
                [fromId, target.id], (err, contact) => {
                if (contact) {
                    return res.json({ error: 'این کاربر قبلاً در لیست مخاطبین شماست' });
                }
                db.run(`INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?)`,
                    [fromId, target.id],
                    function(err) {
                        if (err) {
                            res.json({ error: 'خطا در ارسال درخواست' });
                        } else {
                            let targetSocket = null;
                            for (let [sid, uid] of Object.entries(onlineUsers)) {
                                if (uid == target.id) targetSocket = sid;
                            }
                            if (targetSocket) {
                                io.to(targetSocket).emit('new-friend-request', {
                                    fromId: fromId,
                                    fromName: fromName
                                });
                            }
                            res.json({ success: true, message: 'درخواست ارسال شد' });
                        }
                    });
            });
        });
    });
});
app.get('/friend-requests/:userId', (req, res) => {
    db.all(`
        SELECT fr.*, u.name, u.username, u.code, u.bio, u.avatar, u.online 
        FROM friend_requests fr
        JOIN users u ON u.id = fr.from_id
        WHERE fr.to_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
    `, [req.params.userId], (err, requests) => {
        res.json(requests || []);
    });
});
app.post('/respond-request', (req, res) => {
    const { requestId, userId, accept } = req.body;
    if (accept) {
        db.get(`SELECT * FROM friend_requests WHERE id = ? AND to_id = ?`, 
            [requestId, userId], (err, request) => {
            if (!request) {
                return res.json({ error: 'درخواست یافت نشد' });
            }
            db.run(`INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)`, 
                [request.from_id, request.to_id]);
            db.run(`INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)`, 
                [request.to_id, request.from_id]);
            db.run(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`, [requestId]);
            let fromSocket = null;
            for (let [sid, uid] of Object.entries(onlineUsers)) {
                if (uid == request.from_id) fromSocket = sid;
            }
            if (fromSocket) {
                io.to(fromSocket).emit('request-accepted', { byId: userId });
            }
            res.json({ success: true });
        });
    } else {
        db.run(`UPDATE friend_requests SET status = 'rejected' WHERE id = ? AND to_id = ?`, 
            [requestId, userId], function(err) {
            res.json({ success: true });
        });
    }
});
app.get('/contacts/:userId', (req, res) => {
    db.all(`
        SELECT u.id, u.name, u.username, u.code, u.bio, u.avatar, u.online, u.last_seen
        FROM contacts c
        JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ?
        ORDER BY u.online DESC, u.name ASC
    `, [req.params.userId], (err, contacts) => {
        res.json(contacts || []);
    });
});
// -------------------- پیام خصوصی --------------------
app.get('/private-messages/:user1/:user2', (req, res) => {
    db.all(`
        SELECT * FROM private_messages 
        WHERE ((from_id = ? AND to_id = ? AND deleted_by_sender = 0) 
            OR (from_id = ? AND to_id = ? AND deleted_by_receiver = 0))
        ORDER BY time ASC LIMIT 200
    `, [req.params.user1, req.params.user2, req.params.user2, req.params.user1], (err, msgs) => {
        res.json(msgs || []);
    });
});
app.post('/delete-private-message', (req, res) => {
    const { messageId, userId, forBoth } = req.body;
    if (forBoth) {
        db.run(`DELETE FROM private_messages WHERE id = ?`, [messageId]);
    } else {
        db.get(`SELECT from_id, to_id FROM private_messages WHERE id = ?`, [messageId], (err, msg) => {
            if (msg) {
                if (msg.from_id == userId) {
                    db.run(`UPDATE private_messages SET deleted_by_sender = 1 WHERE id = ?`, [messageId]);
                } else if (msg.to_id == userId) {
                    db.run(`UPDATE private_messages SET deleted_by_receiver = 1 WHERE id = ?`, [messageId]);
                }
            }
        });
    }
    res.json({ success: true });
});
// -------------------- گروه‌ها --------------------
app.post('/create-group', (req, res) => {
    const { name, bio, isPrivate, ownerId } = req.body;
    const code = generateGroupCode();
    db.run(`INSERT INTO groups (name, code, bio, owner_id, is_private) VALUES (?, ?, ?, ?, ?)`,
        [name, code, bio || '', ownerId, isPrivate ? 1 : 0],
        function(err) {
            if (err) {
                res.json({ error: 'خطا در ساخت گروه' });
            } else {
                const groupId = this.lastID;
                db.run(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`, 
                    [groupId, ownerId]);
                res.json({ success: true, groupId, code });
            }
        });
});
app.get('/search-groups', (req, res) => {
    const q = req.query.q;
    const userId = req.query.userId;
    
    if (!q || q.length < 2) {
        return res.json([]);
    }
    db.all(`
        SELECT g.*, 
               (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
               (SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = ?) as is_member
        FROM groups g
        WHERE (g.name LIKE ? OR g.code LIKE ?) AND g.is_private = 0
        LIMIT 20
    `, [userId, `%${q}%`, `%${q}%`], (err, groups) => {
        res.json(groups || []);
    });
});
app.get('/my-groups/:userId', (req, res) => {
    db.all(`
        SELECT g.*, 
               (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
        FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY g.name ASC
    `, [req.params.userId], (err, groups) => {
        res.json(groups || []);
    });
});
app.post('/join-group', (req, res) => {
    const { groupId, userId } = req.body;
    
    db.get(`SELECT is_private FROM groups WHERE id = ?`, [groupId], (err, group) => {
        if (group && group.is_private) {
            return res.json({ error: 'گروه خصوصی است' });
        }  
        db.run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
            [groupId, userId], function(err) {
                if (err) {
                    res.json({ error: 'خطا در عضویت' });
                } else {
                    res.json({ success: true });
                }
            });
    });
});
app.get('/group-messages/:groupId', (req, res) => {
    db.all(`
        SELECT gm.*, u.name as sender_name, u.avatar as sender_avatar
        FROM group_messages gm
        JOIN users u ON u.id = gm.from_id
        WHERE gm.group_id = ? AND gm.deleted = 0
        ORDER BY gm.time ASC LIMIT 200
    `, [req.params.groupId], (err, messages) => {
        res.json(messages || []);
    });
});
// -------------------- آپلود فایل --------------------
app.post('/upload', upload.single('file'), (req, res) => {
    res.json({ path: `/uploads/${req.file.filename}` });
});
// -------------------- Socket.IO --------------------
const onlineUsers = {};
io.on('connection', (socket) => {    
    socket.on('user-online', (userId) => {
        onlineUsers[socket.id] = userId;
        db.run(`UPDATE users SET online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?`, [userId]);
        io.emit('status-change', { userId, online: true });
    });
    socket.on('send-private-message', (data) => {
        const { from, to, text, file, selfDestruct, replyTo } = data;
        
        db.get(`SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?`, 
            [from, to], (err, contact) => {
            if (!contact) {
                socket.emit('message-error', { error: 'شما با این کاربر مخاطب نیستید' });
                return;
            }
            const expiresAt = selfDestruct ? new Date(Date.now() + 10000).toISOString() : null;
            db.run(`INSERT INTO private_messages (from_id, to_id, text, file, self_destruct, expires_at, reply_to) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [from, to, text || null, file || null, selfDestruct ? 1 : 0, expiresAt, replyTo || null],
                function(err) {
                    if (err) return;
                    let targetSocket = null;
                    for (let [sid, uid] of Object.entries(onlineUsers)) {
                        if (uid == to) targetSocket = sid;
                    }
                    const msgData = {
                        id: this.lastID,
                        from_id: from,
                        to_id: to,
                        text: text,
                        file: file,
                        time: new Date().toISOString(),
                        self_destruct: selfDestruct,
                        reply_to: replyTo
                    };
                    if (targetSocket) {
                        io.to(targetSocket).emit('new-private-message', msgData);
                    }
                    socket.emit('private-message-sent', msgData);
                    if (selfDestruct && targetSocket) {
                        setTimeout(() => {
                            db.run(`DELETE FROM private_messages WHERE id = ?`, [this.lastID]);
                            io.to(targetSocket).emit('message-deleted', { id: this.lastID });
                            socket.emit('message-deleted', { id: this.lastID });
                        }, 10000);
                    }
                });
        });
    });
    socket.on('send-group-message', (data) => {
        const { groupId, from, text, file, replyTo } = data;
        db.run(`INSERT INTO group_messages (group_id, from_id, text, file, reply_to) 
                VALUES (?, ?, ?, ?, ?)`,
            [groupId, from, text || null, file || null, replyTo || null],
            function(err) {
                if (err) return;
                db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, members) => {
                    const msgData = {
                        id: this.lastID,
                        group_id: groupId,
                        from_id: from,
                        text: text,
                        file: file,
                        time: new Date().toISOString(),
                        reply_to: replyTo
                    };
                    for (let [sid, uid] of Object.entries(onlineUsers)) {
                        if (members.some(m => m.user_id == uid)) {
                            io.to(sid).emit('new-group-message', msgData);
                        }
                    }
                });
            });
    });
    socket.on('typing-private', (data) => {
        const { from, to, isTyping } = data;
        let targetSocket = null;
        for (let [sid, uid] of Object.entries(onlineUsers)) {
            if (uid == to) targetSocket = sid;
        }
        if (targetSocket) {
            io.to(targetSocket).emit('user-typing', { userId: from, isTyping });
        }
    });
    socket.on('typing-group', (data) => {
        const { groupId, from, isTyping, userName } = data;
        db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, members) => {
            for (let [sid, uid] of Object.entries(onlineUsers)) {
                if (members.some(m => m.user_id == uid) && uid != from) {
                    io.to(sid).emit('group-typing', { groupId, userName, isTyping });
                }
            }
        });
    });
    socket.on('delete-message', (data) => {
        const { messageId, type, userId, forBoth } = data;
        if (type === 'private') {
            if (forBoth) {
                db.run(`DELETE FROM private_messages WHERE id = ?`, [messageId]);
            } else {
                db.get(`SELECT from_id, to_id FROM private_messages WHERE id = ?`, [messageId], (err, msg) => {
                    if (msg) {
                        if (msg.from_id == userId) {
                            db.run(`UPDATE private_messages SET deleted_by_sender = 1 WHERE id = ?`, [messageId]);
                        } else if (msg.to_id == userId) {
                            db.run(`UPDATE private_messages SET deleted_by_receiver = 1 WHERE id = ?`, [messageId]);
                        }
                    }
                });
            }
            io.emit('message-deleted', { id: messageId, type });
        } else if (type === 'group') {
            db.run(`UPDATE group_messages SET deleted = 1 WHERE id = ?`, [messageId]);
            io.emit('group-message-deleted', { id: messageId });
        }
    });
    socket.on('disconnect', () => {
        const userId = onlineUsers[socket.id];
        if (userId) {
            delete onlineUsers[socket.id];
            db.run(`UPDATE users SET online = 0, last_seen = CURRENT_TIMESTAMP WHERE id = ?`, [userId]);
            io.emit('status-change', { userId, online: false });
        }
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 پیام‌رسان حار`);
    console.log(`📍 آدرس: http://localhost:${PORT}`);
    console.log(`\n✅ سرور آماده است`);
});