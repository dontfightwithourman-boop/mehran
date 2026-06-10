let socket;
let currentUser = null;
let currentChat = {
    type: null,
    id: null,
    name: null,
    otherId: null
};
let contacts = [];
let groups = [];
let pendingRequests = [];
let currentReplyTo = null;
let currentDeleteMessage = null;
let typingTimeout;
let currentRequestId = null;
let currentSearchTab = 'users';

async function api(url, data) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function get(url) {
    const res = await fetch(url);
    return res.json();
}

function render() {
    if (!currentUser) {
        renderAuth();
    } else {
        renderApp();
    }
}

function renderAuth() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="auth-page">
            <div class="auth-card">
                <h2>💬 پیام‌رسان حار</h2>
                <div id="auth-box">
                    <input type="text" id="login-username" placeholder="کلمه عبور">
                    <input type="password" id="login-password" placeholder="رمز عبور">
                    <button onclick="login()">ورود</button>
                    <div class="toggle" onclick="showRegister()">ثبت نام جدید</div>
                    <div id="auth-msg" class="error"></div>
                </div>
            </div>
        </div>
    `;
}

function showRegister() {
    const box = document.getElementById('auth-box');
    box.innerHTML = `
        <input type="text" id="reg-username" placeholder="کلمه عبور">
        <input type="password" id="reg-password" placeholder="رمز عبور">
        <input type="text" id="reg-name" placeholder="نام کاربری">
        <button onclick="register()">ثبت نام</button>
        <div class="toggle" onclick="renderAuth()">بازگشت</div>
        <div id="auth-msg" class="error"></div>
    `;
}

async function register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const name = document.getElementById('reg-name').value;
    
    if (!username || !password || !name) {
        document.getElementById('auth-msg').innerText = 'همه فیلدها را پر کنید';
        return;
    }
    
    const res = await api('/register', { username, password, name });
    
    if (res.error) {
        document.getElementById('auth-msg').innerText = res.error;
    } else {
        document.getElementById('auth-box').innerHTML = `
            <div class="success">✅ ثبت نام موفق!</div>
            <div class="code-box">
                <div>کد دعوت شما:</div>
                <span>${res.code}</span>
            </div>
            <button onclick="renderAuth()" style="margin-top:15px">رفتن به صفحه ورود</button>
        `;
    }
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    const res = await api('/login', { username, password });
    
    if (res.error) {
        document.getElementById('auth-msg').innerText = res.error;
    } else {
        currentUser = res.user;
        initSocket();
        await loadContacts();
        await loadGroups();
        await loadFriendRequests();
        render();
    }
}

function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('user-online', currentUser.id);
    });
    
    socket.on('new-private-message', (msg) => {
        if (currentChat.type === 'private' && currentChat.otherId === msg.from_id) {
            addPrivateMessage(msg, false);
        }
        loadContacts();
        playNotification();
    });
    
    socket.on('private-message-sent', (msg) => {
        if (currentChat.type === 'private' && currentChat.otherId === msg.to_id) {
            addPrivateMessage(msg, true);
        }
    });
    
    socket.on('new-group-message', (msg) => {
        if (currentChat.type === 'group' && currentChat.id === msg.group_id) {
            addGroupMessage(msg, msg.from_id === currentUser.id);
        }
        loadGroups();
        playNotification();
    });
    
    socket.on('message-deleted', ({ id, type }) => {
        const msgElement = document.querySelector(`.message[data-id="${id}"]`);
        if (msgElement) {
            msgElement.style.opacity = '0.5';
            msgElement.innerHTML = '<div class="message-bubble">🗑️ پیام حذف شد</div>';
            setTimeout(() => msgElement.remove(), 2000);
        }
    });
    
    socket.on('status-change', ({ userId, online }) => {
        const contact = contacts.find(c => c.id === userId);
        if (contact) contact.online = online;
        renderContacts();
        if (currentChat.type === 'private' && currentChat.otherId === userId) {
            const statusEl = document.getElementById('chat-status');
            if (statusEl) statusEl.innerHTML = online ? '🟢 آنلاین' : '⚪ آفلاین';
        }
    });
    
    socket.on('user-typing', ({ userId, isTyping }) => {
        if (currentChat.type === 'private' && currentChat.otherId === userId) {
            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
                indicator.style.display = isTyping ? 'block' : 'none';
                if (isTyping) indicator.innerHTML = `${currentChat.name} در حال تایپ است...`;
            }
        }
    });
    
    socket.on('group-typing', ({ groupId, userName, isTyping }) => {
        if (currentChat.type === 'group' && currentChat.id === groupId && userName !== currentUser.name) {
            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
                indicator.style.display = isTyping ? 'block' : 'none';
                if (isTyping) indicator.innerHTML = `${userName} در حال تایپ است...`;
            }
        }
    });
    
    socket.on('new-friend-request', ({ fromId, fromName }) => {
        loadFriendRequests();
        playNotification();
        alert(`🔔 درخواست دوستی جدید از ${fromName}`);
    });
    
    socket.on('request-accepted', ({ byId }) => {
        loadContacts();
        alert(`✅ درخواست شما تأیید شد! حالا می‌توانید با این کاربر چت کنید.`);
    });
    
    socket.on('message-error', ({ error }) => {
        alert(error);
    });
}

function playNotification() {
    try {
        const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBhbmQgV2hpc3RsZSB3cm90ZSB0aGlzIGJ1dCBpdCdzIGp1c3QgYSBzaW1wbGUgYmVlcCBzb3VuZA==');
        audio.play().catch(() => {});
    } catch(e) {}
}

async function loadContacts() {
    const res = await get(`/contacts/${currentUser.id}`);
    contacts = res;
    renderContacts();
}

function renderContacts() {
    const container = document.getElementById('contacts-list');
    if (!container) return;
    
    if (contacts.length === 0) {
        container.innerHTML = '<div class="empty">📭 هنوز مخاطبی ندارید<br>با ارسال درخواست دوستی شروع کنید</div>';
        return;
    }
    
    container.innerHTML = contacts.map(c => `
        <div class="contact ${currentChat.type === 'private' && currentChat.otherId === c.id ? 'selected' : ''}" onclick="selectPrivateChat(${c.id}, '${escapeHtml(c.name)}')">
            <div>
                <div class="contact-name">${escapeHtml(c.name)}</div>
                <div class="${c.online ? 'contact-online' : 'contact-offline'}">
                    ${c.online ? '🟢 آنلاین' : '⚪ آفلاین'}
                </div>
            </div>
            <div class="contact-code">📋 ${c.code}</div>
        </div>
    `).join('');
}

async function loadGroups() {
    const res = await get(`/my-groups/${currentUser.id}`);
    groups = res;
    renderGroups();
}

function renderGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    
    if (groups.length === 0) {
        container.innerHTML = '<div class="empty">📭 گروهی نیست</div>';
        return;
    }
    
    container.innerHTML = groups.map(g => `
        <div class="group-item ${currentChat.type === 'group' && currentChat.id === g.id ? 'selected' : ''}" onclick="selectGroupChat(${g.id}, '${escapeHtml(g.name)}')">
            <div class="group-name">👥 ${escapeHtml(g.name)}</div>
            <div class="group-members">${g.member_count || 0} عضو</div>
        </div>
    `).join('');
}

async function selectPrivateChat(userId, name) {
    currentChat = { type: 'private', id: userId, name: name, otherId: userId };
    
    const messages = await get(`/private-messages/${currentUser.id}/${userId}`);
    
    renderContacts();
    renderGroups();
    
    const container = document.getElementById('messages');
    if (messages.length === 0) {
        container.innerHTML = '<div class="empty">💬 پیامی نیست. اولین پیام را بفرستید</div>';
    } else {
        container.innerHTML = '';
        messages.forEach(msg => {
            addPrivateMessage(msg, msg.from_id === currentUser.id);
        });
    }
    
    document.getElementById('chat-name').innerHTML = escapeHtml(name);
    document.getElementById('chat-status').innerHTML = contacts.find(c => c.id === userId)?.online ? '🟢 آنلاین' : '⚪ آفلاین';
    document.getElementById('chat-actions').innerHTML = `
        <button class="chat-action-btn" onclick="openProfileModal(${userId})" title="پروفایل">👤</button>
    `;
    scrollToBottom();
}

async function selectGroupChat(groupId, name) {
    currentChat = { type: 'group', id: groupId, name: name };
    
    const messages = await get(`/group-messages/${groupId}`);
    
    renderContacts();
    renderGroups();
    
    const container = document.getElementById('messages');
    if (messages.length === 0) {
        container.innerHTML = '<div class="empty">💬 پیامی نیست. اولین پیام را بفرستید</div>';
    } else {
        container.innerHTML = '';
        messages.forEach(msg => {
            addGroupMessage(msg, msg.from_id === currentUser.id);
        });
    }
    
    document.getElementById('chat-name').innerHTML = `👥 ${escapeHtml(name)}`;
    document.getElementById('chat-status').innerHTML = `${messages.length} پیام`;
    document.getElementById('chat-actions').innerHTML = `
        <button class="chat-action-btn" onclick="openGroupInfo(${groupId})" title="اطلاعات گروه">ℹ️</button>
    `;
    scrollToBottom();
}

function addPrivateMessage(msg, isSent) {
    const container = document.getElementById('messages');
    const empty = container.querySelector('.empty');
    if (empty) empty.remove();
    
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'} private-message`;
    div.setAttribute('data-id', msg.id);
    div.setAttribute('data-from', msg.from_id);
    div.setAttribute('data-to', msg.to_id);
    
    let replyHtml = '';
    if (msg.reply_to) {
        replyHtml = `<div class="reply-indicator">↩️ پاسخ به پیام</div>`;
    }
    
    div.innerHTML = `
        <div class="message-bubble">
            ${replyHtml}
            <div class="message-text">${escapeHtml(msg.text) || (msg.file ? '📎 فایل' : '')}</div>
            ${msg.file ? `<div class="message-file"><img src="${msg.file}" onclick="window.open('${msg.file}')"></div>` : ''}
            <div class="message-time">${new Date(msg.time).toLocaleTimeString('fa-IR')}</div>
            ${msg.self_destruct ? '<div class="self-destruct-badge">💣 خودتخریب</div>' : ''}
        </div>
        <div class="message-menu">
            <button class="message-menu-btn" onclick="showReplyModal(${msg.id}, '${escapeHtml(msg.text)}')">↩️</button>
            <button class="message-menu-btn" onclick="showDeleteModal(${msg.id}, 'private')">🗑️</button>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function addGroupMessage(msg, isSent) {
    const container = document.getElementById('messages');
    const empty = container.querySelector('.empty');
    if (empty) empty.remove();
    
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'} group-message`;
    div.setAttribute('data-id', msg.id);
    
    let senderName = isSent ? '' : `<div style="font-size:11px;margin-bottom:4px;color:#667eea">${escapeHtml(msg.sender_name)}</div>`;
    let replyHtml = '';
    if (msg.reply_to) {
        replyHtml = `<div class="reply-indicator">↩️ پاسخ به پیام</div>`;
    }
    
    div.innerHTML = `
        <div class="message-bubble">
            ${senderName}
            ${replyHtml}
            <div class="message-text">${escapeHtml(msg.text) || (msg.file ? '📎 فایل' : '')}</div>
            ${msg.file ? `<div class="message-file"><img src="${msg.file}" onclick="window.open('${msg.file}')"></div>` : ''}
            <div class="message-time">${new Date(msg.time).toLocaleTimeString('fa-IR')}</div>
        </div>
        <div class="message-menu">
            <button class="message-menu-btn" onclick="showReplyModalGroup(${msg.id}, '${escapeHtml(msg.text)}')">↩️</button>
            ${isSent ? `<button class="message-menu-btn" onclick="showDeleteModal(${msg.id}, 'group')">🗑️</button>` : ''}
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const container = document.getElementById('messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    const selfDestruct = document.getElementById('self-destruct')?.checked || false;
    
    if (!text) return;
    
    if (currentChat.type === 'private') {
        socket.emit('send-private-message', {
            from: currentUser.id,
            to: currentChat.id,
            text: text,
            file: null,
            selfDestruct: selfDestruct,
            replyTo: currentReplyTo
        });
    } else if (currentChat.type === 'group') {
        socket.emit('send-group-message', {
            groupId: currentChat.id,
            from: currentUser.id,
            text: text,
            file: null,
            replyTo: currentReplyTo
        });
    }
    
    input.value = '';
    currentReplyTo = null;
    if (selfDestruct) {
        document.getElementById('self-destruct').checked = false;
    }
}

function handleTyping() {
    if (!currentChat.type) return;
    
    if (currentChat.type === 'private') {
        socket.emit('typing-private', {
            from: currentUser.id,
            to: currentChat.id,
            isTyping: true
        });
    } else if (currentChat.type === 'group') {
        socket.emit('typing-group', {
            groupId: currentChat.id,
            from: currentUser.id,
            isTyping: true,
            userName: currentUser.name
        });
    }
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        if (currentChat.type === 'private') {
            socket.emit('typing-private', {
                from: currentUser.id,
                to: currentChat.id,
                isTyping: false
            });
        } else if (currentChat.type === 'group') {
            socket.emit('typing-group', {
                groupId: currentChat.id,
                from: currentUser.id,
                isTyping: false,
                userName: currentUser.name
            });
        }
    }, 1000);
}

async function loadFriendRequests() {
    const requests = await get(`/friend-requests/${currentUser.id}`);
    pendingRequests = requests;
    updateRequestBadge();
}

function updateRequestBadge() {
    const badge = document.getElementById('requestBadge');
    if (badge) {
        if (pendingRequests.length > 0) {
            badge.style.display = 'inline-flex';
            badge.innerText = pendingRequests.length;
        } else {
            badge.style.display = 'none';
        }
    }
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

async function openRequestsModal() {
    await loadFriendRequests();
    const container = document.getElementById('requestsList');
    
    if (pendingRequests.length === 0) {
        container.innerHTML = '<div class="empty">📭 درخواستی ندارید</div>';
    } else {
        container.innerHTML = pendingRequests.map(req => `
            <div class="request-item">
                <div class="request-info">
                    <div class="request-name">${escapeHtml(req.name)}</div>
                    <div class="request-code">📋 ${req.code}</div>
                </div>
                <div class="request-actions">
                    <button class="request-accept" onclick="showResponseModal(${req.id}, '${escapeHtml(req.name)}', ${req.from_id})">✅</button>
                    <button class="request-reject" onclick="respondToRequest(${req.id}, false)">❌</button>
                </div>
            </div>
        `).join('');
    }
    openModal('requestsModal');
}

function showResponseModal(requestId, userName, fromId) {
    currentRequestId = requestId;
    document.getElementById('responseBody').innerHTML = `
        <div style="text-align:center;padding:10px">
            <div style="font-size:48px;margin-bottom:10px">👤</div>
            <div style="font-size:18px;font-weight:bold;margin-bottom:5px">${escapeHtml(userName)}</div>
            <div style="color:#a0aec0">می‌خواهد با شما دوست شود</div>
        </div>
    `;
    closeModal('requestsModal');
    openModal('responseModal');
}

async function respondToCurrentRequest(accept) {
    if (!currentRequestId) return;
    await respondToRequest(currentRequestId, accept);
    currentRequestId = null;
    closeModal('responseModal');
    await loadFriendRequests();
    await loadContacts();
    updateRequestBadge();
}

async function respondToRequest(requestId, accept) {
    const res = await api('/respond-request', { requestId, userId: currentUser.id, accept });
    if (res.success) {
        if (accept) alert('✅ مخاطب با موفقیت اضافه شد');
        return true;
    }
    return false;
}

function openSendRequestModal() {
    document.getElementById('requestCode').value = '';
    document.getElementById('searchPreview').style.display = 'none';
    const sendBtn = document.getElementById('sendRequestBtn');
    if (sendBtn) sendBtn.disabled = true;
    openModal('sendRequestModal');
}

let searchTimeout;
document.addEventListener('DOMContentLoaded', () => {
    const codeInput = document.getElementById('requestCode');
    if (codeInput) {
        codeInput.addEventListener('input', async (e) => {
            clearTimeout(searchTimeout);
            const code = e.target.value;
            if (code.length === 6) {
                searchTimeout = setTimeout(async () => {
                    const user = await get(`/find-by-code?code=${code}`);
                    const preview = document.getElementById('searchPreview');
                    if (user.error) {
                        preview.style.display = 'none';
                        const sendBtn = document.getElementById('sendRequestBtn');
                        if (sendBtn) sendBtn.disabled = true;
                    } else {
                        document.getElementById('previewName').innerHTML = escapeHtml(user.name);
                        document.getElementById('previewCode').innerHTML = `📋 ${user.code}`;
                        preview.style.display = 'block';
                        const sendBtn = document.getElementById('sendRequestBtn');
                        if (sendBtn) sendBtn.disabled = false;
                    }
                }, 500);
            } else {
                document.getElementById('searchPreview').style.display = 'none';
                const sendBtn = document.getElementById('sendRequestBtn');
                if (sendBtn) sendBtn.disabled = true;
            }
        });
    }
});

async function submitFriendRequest() {
    const code = document.getElementById('requestCode').value;
    const res = await api('/send-request', {
        fromId: currentUser.id,
        toCode: code,
        fromName: currentUser.name
    });
    
    if (res.error) {
        alert(res.error);
    } else {
        alert('✅ درخواست دوستی ارسال شد');
        closeModal('sendRequestModal');
    }
}

function openMyProfileModal() {
    document.getElementById('profileName').value = currentUser.name;
    document.getElementById('profileBio').value = currentUser.bio || '';
    document.getElementById('profileCode').innerHTML = currentUser.code;
    openModal('myProfileModal');
}

async function updateProfile() {
    const name = document.getElementById('profileName').value;
    const bio = document.getElementById('profileBio').value;
    
    const res = await api('/update-profile', { userId: currentUser.id, name, bio });
    if (res.success) {
        currentUser.name = name;
        currentUser.bio = bio;
        alert('✅ پروفایل بروزرسانی شد');
        closeModal('myProfileModal');
        render();
    } else {
        alert('❌ خطا در بروزرسانی');
    }
}

async function openProfileModal(userId) {
    const user = await get(`/user-profile/${userId}`);
    if (user.error) {
        alert(user.error);
        return;
    }
    
    document.getElementById('profileBody').innerHTML = `
        <div style="text-align:center">
            <div class="avatar-large" style="margin:0 auto 20px auto">👤</div>
            <div class="profile-field">
                <label>نام</label>
                <div class="profile-input" style="background:#1a202c">${escapeHtml(user.name)}</div>
            </div>
            <div class="profile-field">
                <label>بیوگرافی</label>
                <div class="profile-input" style="background:#1a202c">${escapeHtml(user.bio) || '—'}</div>
            </div>
            <div class="profile-field">
                <label>کد دعوت</label>
                <div class="profile-code" style="background:#1a202c">${user.code}</div>
            </div>
            <div class="profile-field">
                <label>عضو از</label>
                <div class="profile-input" style="background:#1a202c">${new Date(user.created_at).toLocaleDateString('fa-IR')}</div>
            </div>
        </div>
    `;
    openModal('profileModal');
}

function openCreateGroupModal() {
    document.getElementById('groupName').value = '';
    document.getElementById('groupBio').value = '';
    document.getElementById('groupPrivate').checked = false;
    openModal('createGroupModal');
}

async function createGroup() {
    const name = document.getElementById('groupName').value;
    const bio = document.getElementById('groupBio').value;
    const isPrivate = document.getElementById('groupPrivate').checked;
    
    if (!name) {
        alert('نام گروه را وارد کنید');
        return;
    }
    
    const res = await api('/create-group', { name, bio, isPrivate, ownerId: currentUser.id });
    if (res.success) {
        alert(`✅ گروه "${name}" ساخته شد! کد: ${res.code}`);
        closeModal('createGroupModal');
        await loadGroups();
        render();
    } else {
        alert('❌ خطا در ساخت گروه');
    }
}

function openSearchModal() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '<div class="empty">🔍 جستجو را شروع کنید...</div>';
    document.querySelectorAll('.search-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelector('.search-tab[data-tab="users"]').classList.add('active');
    currentSearchTab = 'users';
    openModal('searchModal');
}

function switchSearchTab(tab) {
    currentSearchTab = tab;
    document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.search-tab[data-tab="${tab}"]`).classList.add('active');
    performSearch();
}

async function performSearch() {
    const query = document.getElementById('searchInput').value;
    if (!query || query.length < 2) {
        document.getElementById('searchResults').innerHTML = '<div class="empty">🔍 حداقل ۲ کاراکتر وارد کنید</div>';
        return;
    }
    
    let results = [];
    if (currentSearchTab === 'users') {
        results = await get(`/search-users?q=${query}&userId=${currentUser.id}`);
        document.getElementById('searchResults').innerHTML = results.map(user => `
            <div class="search-result-item" onclick="sendFriendRequestByCode('${user.code}')">
                <div>
                    <div class="search-result-name">${escapeHtml(user.name)}</div>
                    <div class="search-result-desc">📋 ${user.code} • ${user.online ? '🟢 آنلاین' : '⚪ آفلاین'}</div>
                </div>
                <button class="join-btn">➕ درخواست</button>
            </div>
        `).join('');
        if (results.length === 0) {
            document.getElementById('searchResults').innerHTML = '<div class="empty">❌ کاربری یافت نشد</div>';
        }
    } else if (currentSearchTab === 'groups') {
        results = await get(`/search-groups?q=${query}&userId=${currentUser.id}`);
        document.getElementById('searchResults').innerHTML = results.map(group => `
            <div class="search-result-item" onclick="joinGroup(${group.id})">
                <div>
                    <div class="search-result-name">👥 ${escapeHtml(group.name)}</div>
                    <div class="search-result-desc">📋 ${group.code} • ${group.member_count || 0} عضو</div>
                </div>
                ${group.is_member ? '<span style="color:#48bb78">✅ عضو</span>' : '<button class="join-btn">➕ عضو شدن</button>'}
            </div>
        `).join('');
        if (results.length === 0) {
            document.getElementById('searchResults').innerHTML = '<div class="empty">❌ گروهی یافت نشد</div>';
        }
    }
}

async function sendFriendRequestByCode(code) {
    const res = await api('/send-request', { fromId: currentUser.id, toCode: code, fromName: currentUser.name });
    if (res.error) {
        alert(res.error);
    } else {
        alert('✅ درخواست دوستی ارسال شد');
        closeModal('searchModal');
    }
}

async function joinGroup(groupId) {
    const res = await api('/join-group', { groupId, userId: currentUser.id });
    if (res.error) {
        alert(res.error);
    } else {
        alert('✅ به گروه پیوستید');
        closeModal('searchModal');
        await loadGroups();
        render();
    }
}

function showReplyModal(messageId, messageText) {
    currentReplyTo = messageId;
    document.getElementById('replyPreview').innerHTML = `پاسخ به: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`;
    document.getElementById('replyText').value = '';
    openModal('replyModal');
}

function sendReply() {
    const replyText = document.getElementById('replyText').value;
    if (!replyText) {
        alert('متن پیام را وارد کنید');
        return;
    }
    
    document.getElementById('message-input').value = replyText;
    closeModal('replyModal');
    sendMessage();
}

function showDeleteModal(messageId, type) {
    currentDeleteMessage = { id: messageId, type };
    openModal('deleteModal');
}

async function confirmDeleteMessage() {
    const forBoth = document.getElementById('deleteForBoth')?.checked || false;
    
    await api('/delete-private-message', {
        messageId: currentDeleteMessage.id,
        userId: currentUser.id,
        forBoth: forBoth
    });
    
    socket.emit('delete-message', {
        messageId: currentDeleteMessage.id,
        type: currentDeleteMessage.type,
        userId: currentUser.id,
        forBoth: forBoth
    });
    
    closeModal('deleteModal');
    currentDeleteMessage = null;
}

function attachFile() {
    const input = document.getElementById('file-input');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !currentChat.type) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.path) {
            if (currentChat.type === 'private') {
                socket.emit('send-private-message', {
                    from: currentUser.id,
                    to: currentChat.id,
                    text: null,
                    file: data.path,
                    selfDestruct: false,
                    replyTo: null
                });
            } else if (currentChat.type === 'group') {
                socket.emit('send-group-message', {
                    groupId: currentChat.id,
                    from: currentUser.id,
                    text: null,
                    file: data.path,
                    replyTo: null
                });
            }
        }
    };
    input.click();
}

function openGroupInfo(groupId) {
    alert(`اطلاعات گروه در حال توسعه...\nشناسه: ${groupId}`);
}

function logout() {
    if (socket) socket.disconnect();
    currentUser = null;
    currentChat = { type: null, id: null, name: null, otherId: null };
    render();
}

function renderApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="app-container">
            <div class="sidebar">
                <div class="sidebar-header">
                    <h3 onclick="openMyProfileModal()">${escapeHtml(currentUser.name)}</h3>
                    <div class="my-code" onclick="openMyProfileModal()">
                        🔑 کد من: <span>${currentUser.code}</span>
                    </div>
                    <div class="header-buttons">
                        <div class="icon-btn" onclick="openSendRequestModal()">
                            <div class="icon">➕</div>
                            <span class="icon-label">درخواست</span>
                        </div>
                        <div class="icon-btn" onclick="openRequestsModal()">
                            <div class="icon">📬</div>
                            <span class="icon-label">درخواست‌ها</span>
                            <span id="requestBadge" class="badge" style="display:none">0</span>
                        </div>
                        <div class="icon-btn" onclick="openCreateGroupModal()">
                            <div class="icon">👥</div>
                            <span class="icon-label">گروه</span>
                        </div>
                        <div class="icon-btn" onclick="openSearchModal()">
                            <div class="icon">🔍</div>
                            <span class="icon-label">جستجو</span>
                        </div>
                    </div>
                    <button class="btn-danger" onclick="logout()">🚪 خروج</button>
                </div>
                
                <div class="contacts-list" id="contacts-list"></div>
                
                <div class="groups-list" id="groups-list"></div>
            </div>
            
            <div class="chat-area">
                <div class="chat-header">
                    <div>
                        <h3 id="chat-name">انتخاب کنید</h3>
                        <div id="chat-status" class="chat-status"></div>
                    </div>
                    <div id="chat-actions" class="chat-actions"></div>
                </div>
                <div class="messages" id="messages">
                    <div class="empty">👉 یک مخاطب یا گروه را انتخاب کنید</div>
                </div>
                <div id="typing-indicator" class="typing-indicator" style="display:none"></div>
                <div class="input-area">
                    <button class="attach-btn" onclick="attachFile()">📎</button>
                    <input type="text" id="message-input" placeholder="پیام خود را بنویسید..." 
                           onkeypress="if(event.key==='Enter') sendMessage()" 
                           oninput="handleTyping()">
                    <label class="destruct-label">
                        <input type="checkbox" id="self-destruct"> 💣 خودتخریب
                    </label>
                    <button class="send-btn" onclick="sendMessage()">📤 ارسال</button>
                    <input type="file" id="file-input" style="display:none">
                </div>
            </div>
        </div>
    `;
    renderContacts();
    renderGroups();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

render();