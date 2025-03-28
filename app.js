// Backend URL'sini burada sabit olarak belirtin
const BACKEND_URL = "https://locsaverapi20240122143141.azurewebsites.net"; // Backend'in çalıştığı URL'yi buraya yazın

// Değişkenler
let connection;
let peerConnection;
let localStream;
let remoteStream;
let targetUserId;
let currentUserId = "";
let currentUsername = "";

// DOM elementleri
const connectionContainer = document.getElementById('connectionContainer');
const tokenInput = document.getElementById('tokenInput');
const connectButton = document.getElementById('connectButton');
const connectionStatus = document.getElementById('connectionStatus');
const loginContainer = document.getElementById('loginContainer');
const callContainer = document.getElementById('callContainer');
const loginButton = document.getElementById('loginButton');
const loginError = document.getElementById('loginError');
const currentUserIdElement = document.getElementById('currentUserId');
const currentUsernameElement = document.getElementById('currentUsername');
const userList = document.getElementById('userList');
const callToUserId = document.getElementById('callToUserId');
const callButton = document.getElementById('callButton');
const endCallButton = document.getElementById('endCallButton');
const troubleshootButton = document.getElementById('troubleshootButton');
const remoteAudio = document.getElementById('remoteAudio');
const connectionIdElement = document.getElementById('connectionId');
const selectSpeakerButton = document.getElementById('selectSpeakerButton');
const audioOutputSelect = document.getElementById('audioOutputSelect');
const volumeControl = document.getElementById('volumeControl');
const volumeValue = document.getElementById('volumeValue');
// Gelen arama bildirimi elementleri
const incomingCallContainer = document.getElementById('incomingCallContainer');
const incomingCallUsername = document.getElementById('incomingCallUsername');
const answerCallBtn = document.getElementById('answerCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');
const ringtone = document.getElementById('ringtone');

// Ses seviyesini ayarla
remoteAudio.volume = 1.0;

// Token'dan kullanıcı ID'sini çıkar
function parseJwt(token) {
    try {
        // Base64Url'yi decode et
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error("Token parse edilemedi:", error);
        return null;
    }
}

// Aramayı cevapla butonuna tıklama olayı
answerCallBtn.addEventListener('click', () => {
    answerCall();
});

// Aramayı reddet butonuna tıklama olayı
rejectCallBtn.addEventListener('click', () => {
    rejectCall(targetUserId);
});

// Zil sesi çal
function playRingtone() {
    if (ringtone) {
        ringtone.play().catch(error => {
            console.warn("Zil sesi otomatik çalınamadı:", error);
        });
    }
}

// Zil sesini durdur
function stopRingtone() {
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
}

// Bağlan butonuna tıklama olayı
connectButton.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    
    if (!token) {
        alert("Lütfen JWT token'ı girin");
        return;
    }
    
    // Token'ı localStorage'a kaydet
    localStorage.setItem("token", token);
    
    // Bağlantıyı oluştur
    createConnection(token);
    
    // Bağlantıyı başlat
    await startConnection();
});

// SignalR bağlantısını oluştur
function createConnection(token) {
    connection = new signalR.HubConnectionBuilder()
        .withUrl(`${BACKEND_URL}/chats/chatHub`, {
            accessTokenFactory: () => token
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.Debug)
        .build();
    
    // SignalR olaylarını dinle
    setupSignalRHandlers();
}

// setupSignalRHandlers fonksiyonunu güncelleyin
function setupSignalRHandlers() {
    // Bağlantı olayları
    connection.onreconnecting(error => {
        console.log("SignalR yeniden bağlanıyor:", error);
        connectionStatus.textContent = "Bağlantı durumu: Yeniden bağlanıyor...";
        showNotification("Sunucu bağlantısı kesintiye uğradı. Yeniden bağlanılıyor...", "warning");
    });
    
    connection.onreconnected(connectionId => {
        console.log("SignalR yeniden bağlandı:", connectionId);
        connectionStatus.textContent = "Bağlantı durumu: Bağlı";
        connectionIdElement.textContent = connectionId;
        showNotification("Sunucu bağlantısı yeniden kuruldu.", "success");
        
        // Yeniden bağlandığında otomatik giriş yap
        autoLogin();
    });
    
    connection.onclose(error => {
        console.log("SignalR bağlantısı kapandı:", error);
        connectionStatus.textContent = "Bağlantı durumu: Kapalı";
        showNotification("Sunucu bağlantısı kapandı.", "error");
    });
    
    // WebRTC olayları
    connection.on("call-made", async (data) => {
        console.log("Gelen arama:", data);
        
        // Gelen arama bilgilerini kaydet
        targetUserId = parseInt(data.socket);
        
        // Kullanıcıya gelen arama bildirimi göster
        incomingCallUsername.textContent = data.username;
        incomingCallContainer.classList.remove('hidden');
        
        // Zil sesi çal
        playRingtone();
        
        // Gelen aramayı işle
        await handleIncomingCall(data.offer);
    });
    
    connection.on("answer-made", async (data) => {
        console.log("Gelen cevap:", data);
        await handleAnswer(data.answer);
    });
    
    connection.on("ice-candidate", async (data) => {
        console.log("Gelen ICE adayı:", data);
        await handleIceCandidate(data.candidate);
    });
    
    connection.on("call-rejected", (data) => {
        console.log("Arama reddedildi:", data);
        showNotification("Arama reddedildi.", "warning");
        endCall();
    });
    
    connection.on("call-ended", (data) => {
        console.log("Arama sonlandırıldı:", data);
        showNotification("Arama sonlandırıldı.", "info");
        endCall();
    });
    
    // Hata olayları
    connection.on("UserNotFound", (message) => {
        console.log("Kullanıcı bulunamadı:", message);
        showNotification(message, "error");
        endCall();
    });
    
    connection.on("CallFailed", (message) => {
        console.log("Arama başarısız:", message);
        showNotification(message, "error");
        endCall();
    });
}

// Otomatik giriş yap
async function autoLogin() {
    try {
        // Token'ı al
        const token = tokenInput.value.trim();
        if (!token) {
            showNotification("Geçerli bir token girilmedi", "error");
            return;
        }
        
        // Token'dan kullanıcı bilgilerini çıkar
        const tokenData = parseJwt(token);
        if (!tokenData) {
            showNotification("Token çözümlenemedi", "error");
            return;
        }
        
        console.log("Token içeriği:", tokenData);
        
        // Token'dan kullanıcı ID'sini al
        // value dizisinin ilk elemanını kullanıcı ID'si olarak al
        let userId = null;
        if (tokenData.value && Array.isArray(tokenData.value) && tokenData.value.length > 0) {
            userId = tokenData.value[0];
        }
        
        if (!userId) {
            showNotification("Token içinde kullanıcı ID bulunamadı", "error");
            return;
        }
        
        console.log("Token'dan çıkarılan kullanıcı ID:", userId);
        
        // SignalR bağlantısının durumunu kontrol et
        if (connection.state !== "Connected") {
            console.log("SignalR bağlantısı kurulu değil. Bağlantı kuruluyor...");
            showNotification("Sunucuya bağlanılıyor...", "warning");
            
            try {
                await startConnection();
            } catch (err) {
                console.error("SignalR bağlantısı kurulamadı:", err);
                showNotification("Sunucuya bağlanılamadı: " + err.message, "error");
                return;
            }
        }
        
        // Kullanıcı kaydını yap
        console.log("Kullanıcı kaydediliyor:", userId);
        const userInfo = await connection.invoke("ValidateAndRegisterUser", parseInt(userId));
        console.log("Kullanıcı kaydı sonucu:", userInfo);
        
        if (userInfo && userInfo.success) {
            currentUserId = userId;
            currentUsername = userInfo.username;
            currentUserIdElement.textContent = userId;
            currentUsernameElement.textContent = currentUsername;
            loginContainer.style.display = 'none';
            callContainer.classList.remove('hidden');
            loginError.style.display = 'none';
            
            // Aktif kullanıcıları al
            updateUserList();
            showNotification("Giriş başarılı: " + currentUsername, "success");
        } else {
            loginError.style.display = 'block';
            showNotification("Token doğrulanamadı veya bu kullanıcı zaten çevrimiçi.", "error");
        }
    } catch (err) {
        console.error("Otomatik giriş yapılamadı:", err);
        showNotification("Otomatik giriş yapılamadı: " + err.message, "error");
    }
}

// Bağlantıyı başlat
async function startConnection() {
    try {
        if (connection.state === "Disconnected") {
            console.log("SignalR bağlantısı başlatılıyor...");
            connectionStatus.textContent = "Bağlantı durumu: Bağlanıyor...";
            
            await connection.start();
            
            console.log("SignalR bağlantısı kuruldu");
            connectionStatus.textContent = "Bağlantı durumu: Bağlı";
            connectionIdElement.textContent = connection.connectionId;
            showNotification("Sunucuya bağlanıldı", "success");
            
            // Bağlantı başarılı olduğunda giriş ekranını göster
            connectionContainer.style.display = 'none';
            loginContainer.classList.remove('hidden');
            
            // Otomatik giriş yap
            await autoLogin();
        }
    } catch (err) {
        console.error("SignalR bağlantısı kurulamadı:", err);
        connectionStatus.textContent = "Bağlantı durumu: Hata";
        showNotification("Sunucuya bağlanılamadı: " + err.message, "error");
        
        // Bağlantı hatası detaylarını göster
        console.log("Bağlantı durumu:", connection.state);
        console.log("Tarayıcı WebSocket desteği:", "WebSocket" in window);
        console.log("Backend URL:", BACKEND_URL);
        
        // 5 saniye sonra yeniden dene
        setTimeout(startConnection, 5000);
    }
}

// Giriş butonuna tıklama olayı
loginButton.addEventListener('click', async () => {
    await autoLogin();
});

// Aktif kullanıcıları güncelle
async function updateUserList() {
    try {
        const users = await connection.invoke("GetActiveUsers");
        userList.innerHTML = '';
        
        users.forEach(user => {
            if (user.userId !== parseInt(currentUserId)) {
                const li = document.createElement('li');
                li.textContent = `${user.userName} (ID: ${user.userId})`;
                li.dataset.userId = user.userId;
                li.addEventListener('click', () => {
                    callToUserId.value = user.userId;
                });
                userList.appendChild(li);
            }
        });
    } catch (err) {
        console.error("Aktif kullanıcılar alınamadı:", err);
    }
}

// handleIncomingCall fonksiyonunu güncelleyin
async function handleIncomingCall(offerJson) {
    try {
        if (!peerConnection) {
            const success = await startWebRTC();
            if (!success) {
                await rejectCall(targetUserId);
                return;
            }
        }
        
        // Gelen offer'ı parse et
        const offer = JSON.parse(offerJson);
        
        // PeerConnection durumunu kontrol et
        if (peerConnection.signalingState !== "stable") {
            console.log("PeerConnection durumu stable değil, sıfırlanıyor...");
            await peerConnection.setLocalDescription({type: "rollback"});
        }
        
        // Uzak açıklamayı ayarla
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        console.log("Uzak açıklama ayarlandı, cevap hazırlanıyor...");
    } catch (error) {
        console.error("Gelen arama işlenemedi:", error);
        showNotification("Gelen arama işlenemedi: " + error.message, "error");
        await rejectCall(targetUserId);
    }
}

// Arama butonuna tıklama olayı
callButton.addEventListener('click', () => {
    const userId = callToUserId.value.trim();
    if (userId) {
        startCall(parseInt(userId));
    } else {
        alert("Lütfen aranacak kullanıcı ID'sini girin");
    }
});

// Aramayı sonlandır butonuna tıklama olayı
endCallButton.addEventListener('click', endCall);

// Sorun giderme butonuna tıklama olayı
troubleshootButton.addEventListener('click', troubleshootAudioStream);

// Hoparlör seçme butonuna tıklama olayı
selectSpeakerButton.addEventListener('click', async () => {
    await enumerateAudioDevices();
});

// Ses çıkış cihazı seçimi değiştiğinde
audioOutputSelect.addEventListener('change', async () => {
    const selectedDeviceId = audioOutputSelect.value;
    if (!selectedDeviceId) return;
    
    try {
        if (typeof remoteAudio.setSinkId === 'function') {
            await remoteAudio.setSinkId(selectedDeviceId);
            console.log("Ses çıkış cihazı değiştirildi:", selectedDeviceId);
            showNotification("Ses çıkışı değiştirildi");
        } else {
            console.warn("setSinkId API'si desteklenmiyor");
            showNotification("Tarayıcınız ses çıkış cihazı seçimini desteklemiyor", "warning");
        }
    } catch (error) {
        console.error("Ses çıkış cihazı değiştirilemedi:", error);
        showNotification("Ses çıkış cihazı değiştirilemedi: " + error.message, "error");
    }
});

// Ses seviyesi kontrolü
volumeControl.addEventListener('input', () => {
    const volume = parseFloat(volumeControl.value);
    remoteAudio.volume = volume;
    volumeValue.textContent = Math.round(volume * 100) + '%';
});

// WebRTC bağlantısını başlat
async function startWebRTC() {
    try {
        // Kullanıcının mikrofonuna erişim iste
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // RTCPeerConnection oluştur
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };
        peerConnection = new RTCPeerConnection(configuration);
        
        // Yerel medya akışını ekle
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log("Yerel ses parçası eklendi:", track.kind, track.id);
        });
        
        // Uzak medya akışını dinle
        peerConnection.ontrack = async (event) => {
            console.log("Uzak ses parçası alındı:", event.track.kind, event.track.id);
            remoteStream = event.streams[0];
            
            // Ses elementine akışı bağla
            remoteAudio.srcObject = remoteStream;
            
            // Ses elementini oynatmaya zorla
            try {
                await remoteAudio.play();
                console.log("Ses oynatma başlatıldı");
            } catch (error) {
                console.error("Ses oynatılamadı:", error);
                showNotification("Ses oynatılamadı. Lütfen ses izinlerini kontrol edin.", "error");
            }
            
            // Ses seviyesini maksimuma ayarla
            remoteAudio.volume = 1.0;
            
            // Ses çıkış cihazını ayarla
            try {
                await selectAudioOutput();
            } catch (error) {
                console.error("Ses çıkış cihazı ayarlanamadı:", error);
            }
            
            showNotification("Karşı tarafın sesi alınıyor. Hoparlörden duymanız gerekiyor.");
            
            // Ses seviyesi analizi başlat
            startAudioAnalysis();
        };
        
        // ICE adaylarını dinle
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("ICE adayı bulundu:", event.candidate.candidate);
                sendIceCandidate(targetUserId, JSON.stringify(event.candidate));
            }
        };
        
        // Bağlantı durumu değişikliklerini izle
        peerConnection.onconnectionstatechange = () => {
            console.log("PeerConnection durumu değişti:", peerConnection.connectionState);
            
            if (peerConnection.connectionState === "connected") {
                showNotification("WebRTC bağlantısı kuruldu", "success");
            } else if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") {
                showNotification("WebRTC bağlantısı kesildi", "warning");
            }
        };
        
        return true;
    } catch (error) {
        console.error("WebRTC başlatılamadı:", error);
        showNotification("Mikrofon erişimi sağlanamadı: " + error.message, "error");
        return false;
    }
}

// Ses seviyesi analizi başlat
function startAudioAnalysis() {
    try {
        // Yerel ses analizi
        if (localStream) {
            const localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const localAudioAnalyser = localAudioContext.createAnalyser();
            const localSource = localAudioContext.createMediaStreamSource(localStream);
            localSource.connect(localAudioAnalyser);
            localAudioAnalyser.fftSize = 256;
            const localBufferLength = localAudioAnalyser.frequencyBinCount;
            const localDataArray = new Uint8Array(localBufferLength);
            
            setInterval(() => {
                localAudioAnalyser.getByteFrequencyData(localDataArray);
                let localSum = 0;
                for(let i = 0; i < localBufferLength; i++) {
                    localSum += localDataArray[i];
                }
                const localAverage = localSum / localBufferLength;
                const localVolume = Math.min(100, Math.max(0, localAverage * 3));
                document.getElementById('localAudioLevelBar').style.width = localVolume + '%';
            }, 100);
        }
        
        // Uzak ses analizi
        if (remoteStream) {
            const remoteAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const remoteAudioAnalyser = remoteAudioContext.createAnalyser();
            const remoteSource = remoteAudioContext.createMediaStreamSource(remoteStream);
            remoteSource.connect(remoteAudioAnalyser);
            remoteAudioAnalyser.fftSize = 256;
            const remoteBufferLength = remoteAudioAnalyser.frequencyBinCount;
            const remoteDataArray = new Uint8Array(remoteBufferLength);
            
            setInterval(() => {
                remoteAudioAnalyser.getByteFrequencyData(remoteDataArray);
                let remoteSum = 0;
                for(let i = 0; i < remoteBufferLength; i++) {
                    remoteSum += remoteDataArray[i];
                }
                const remoteAverage = remoteSum / remoteBufferLength;
                const remoteVolume = Math.min(100, Math.max(0, remoteAverage * 3));
                document.getElementById('remoteAudioLevelBar').style.width = remoteVolume + '%';
            }, 100);
        }
    } catch (error) {
        console.error("Ses analizi başlatılamadı:", error);
    }
}

// Ses çıkış cihazını seçme fonksiyonu
async function selectAudioOutput() {
    try {
        // Tarayıcı desteğini kontrol et
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.warn("Ses çıkış cihazı seçimi desteklenmiyor");
            return;
        }
        
        // Cihazları listele
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
        
        if (audioOutputDevices.length === 0) {
            console.warn("Ses çıkış cihazı bulunamadı");
            return;
        }
        
        console.log("Kullanılabilir ses çıkış cihazları:", audioOutputDevices);
        
        // Varsayılan hoparlörü seç (genellikle ilk cihaz)
        const defaultSpeaker = audioOutputDevices[0];
        
        // Ses elementine çıkış cihazını ayarla (sinkId API'si)
        if (typeof remoteAudio.setSinkId === 'function') {
            await remoteAudio.setSinkId(defaultSpeaker.deviceId);
            console.log("Ses çıkış cihazı ayarlandı:", defaultSpeaker.label);
            showNotification("Ses çıkışı hoparlöre yönlendirildi: " + defaultSpeaker.label);
        } else {
            console.warn("setSinkId API'si desteklenmiyor. Varsayılan ses çıkışı kullanılacak.");
        }
    } catch (error) {
        console.error("Ses çıkış cihazı seçilemedi:", error);
    }
}

// Ses cihazlarını listele
async function enumerateAudioDevices() {
    try {
        // Tarayıcı desteğini kontrol et
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            showNotification("Tarayıcınız cihaz listesini desteklemiyor", "warning");
            return;
        }
        
        // Cihazları listele
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
        
        // Select elementini temizle
        audioOutputSelect.innerHTML = '<option value="">Ses çıkış cihazı seçin...</option>';
        
        // Cihazları ekle
        audioOutputDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Hoparlör ${audioOutputSelect.length}`;
            audioOutputSelect.appendChild(option);
        });
        
        if (audioOutputDevices.length === 0) {
            showNotification("Ses çıkış cihazı bulunamadı", "warning");
        }
    } catch (error) {
        console.error("Ses cihazları listelenirken hata oluştu:", error);
        showNotification("Ses cihazları listelenirken hata oluştu: " + error.message, "error");
    }
}

// startCall fonksiyonunu güncelleyin
async function startCall(userId) {
    if (!userId) {
        alert("Lütfen aranacak kullanıcı ID'sini girin");
        return;
    }
    
    // Kullanıcı ID'sini sayıya çevir
    userId = parseInt(userId);
    if (isNaN(userId)) {
        alert("Geçerli bir kullanıcı ID'si girin (sayısal değer)");
        return;
    }
    
    targetUserId = userId;
    
    if (!peerConnection) {
        const success = await startWebRTC();
        if (!success) return;
    }
    
    try {
        // Offer oluştur
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true
        });
        
        // Yerel açıklamayı ayarla
        await peerConnection.setLocalDescription(offer);
        
        console.log("Arama yapılıyor:", userId);
        console.log("Offer:", JSON.stringify(offer));
        
        // Offer'ı karşı tarafa gönder
        await connection.invoke("CallUser", {
            to: userId,
            offer: JSON.stringify(offer)
        });
        
        // Ses çıkış cihazını ayarla
        await selectAudioOutput();
        
        showNotification(`${userId} ID'li kullanıcı aranıyor. Bağlantı kuruluyor...`);
    } catch (error) {
        console.error("Arama başlatılamadı:", error);
        showNotification("Arama başlatılamadı: " + error.message, "error");
        endCall();
    }
}

// answerCall fonksiyonunu güncelleyin
async function answerCall() {
    try {
        // Zil sesini durdur
        stopRingtone();
        
        // Gelen arama bildirimini gizle
        incomingCallContainer.classList.add('hidden');
        
        // PeerConnection durumunu kontrol et
        if (!peerConnection || peerConnection.signalingState !== "have-remote-offer") {
            console.error("PeerConnection geçerli bir durumda değil:", peerConnection ? peerConnection.signalingState : "null");
            showNotification("Bağlantı durumu uygun değil. Arama cevaplanamadı.", "error");
            return;
        }
        
        // Answer oluştur
        const answer = await peerConnection.createAnswer({
            offerToReceiveAudio: true
        });
        
        // Yerel açıklamayı ayarla
        await peerConnection.setLocalDescription(answer);
        
        console.log("Arama cevaplanıyor:", targetUserId);
        console.log("Answer:", JSON.stringify(answer));
        
        // Answer'ı karşı tarafa gönder
        await connection.invoke("MakeAnswer", {
            to: targetUserId,
            answer: JSON.stringify(answer)
        });
        
        // Ses çıkış cihazını ayarla
        await selectAudioOutput();
        
        showNotification("Arama cevaplandı. Bağlantı kuruluyor...");
    } catch (error) {
        console.error("Arama cevaplanamadı:", error);
        showNotification("Arama cevaplanamadı: " + error.message, "error");
        endCall();
    }
}

// rejectCall fonksiyonunu güncelleyin
async function rejectCall(userId) {
    try {
        // Zil sesini durdur
        stopRingtone();
        
        // Gelen arama bildirimini gizle
        incomingCallContainer.classList.add('hidden');
        
        console.log("Arama reddediliyor:", userId);
        
        // Reddetme bilgisini karşı tarafa gönder
        await connection.invoke("CallRejected", {
            to: userId
        });
        
        endCall();
        
        showNotification("Arama reddedildi.");
    } catch (error) {
        console.error("Arama reddedilemedi:", error);
        showNotification("Arama reddedilemedi: " + error.message, "error");
    }
}

// Gelen cevabı işle
async function handleAnswer(answerJson) {
    try {
        const answer = JSON.parse(answerJson);
        
        // Uzak açıklamayı ayarla
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        console.log("Uzak açıklama ayarlandı");
    } catch (error) {
        console.error("Cevap işlenemedi:", error);
        showNotification("Cevap işlenemedi: " + error.message, "error");
    }
}

// ICE adayını gönder
async function sendIceCandidate(userId, candidateJson) {
    try {
        await connection.invoke("IceCandidate", {
            to: userId,
            candidate: candidateJson
        });
    } catch (error) {
        console.error("ICE adayı gönderilemedi:", error);
    }
}

// Gelen ICE adayını işle
async function handleIceCandidate(candidateJson) {
    try {
        const candidate = JSON.parse(candidateJson);
        
        // ICE adayını ekle
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        
        console.log("ICE adayı eklendi");
    } catch (error) {
        console.error("ICE adayı eklenemedi:", error);
    }
}

// Aramayı sonlandır
function endCall() {
    try {
        // Karşı tarafa aramayı sonlandır bilgisi gönder
        if (targetUserId && connection && connection.state === "Connected") {
            connection.invoke("EndCall", {
                to: targetUserId
            }).catch(err => {
                console.error("Arama sonlandırma bildirimi gönderilemedi:", err);
            });
        }
        
        // Yerel akışı kapat
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        // Uzak akışı kapat
        if (remoteAudio.srcObject) {
            remoteAudio.srcObject = null;
        }
        remoteStream = null;
        
        // PeerConnection'ı kapat
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        targetUserId = null;
        
        // Ses seviyesi göstergelerini sıfırla
        document.getElementById('localAudioLevelBar').style.width = '0%';
        document.getElementById('remoteAudioLevelBar').style.width = '0%';
        
        showNotification("Arama sonlandırıldı");
    } catch (error) {
        console.error("Arama sonlandırılırken hata oluştu:", error);
    }
}

// Ses sorunlarını gider
async function troubleshootAudioStream() {
    console.log("Ses sorunları gideriliyor...");
    
    // Yerel akış kontrolü
    if (!localStream) {
        console.error("Yerel akış mevcut değil");
        showNotification("Mikrofon bağlantısı kurulamadı. Yeniden bağlanılıyor...", "warning");
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            showNotification("Mikrofon bağlantısı yeniden kuruldu", "success");
            
            // PeerConnection'a yeni akışı ekle
            if (peerConnection) {
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });
            }
        } catch (error) {
            console.error("Mikrofon erişimi sağlanamadı:", error);
            showNotification("Mikrofon erişimi sağlanamadı: " + error.message, "error");
            return;
        }
    }
    
    // Yerel ses parçalarını kontrol et
    const localAudioTracks = localStream.getAudioTracks();
    if (localAudioTracks.length === 0) {
        console.error("Yerel ses parçası bulunamadı");
        showNotification("Mikrofon parçası bulunamadı. Mikrofon izinlerini kontrol edin.", "error");
        return;
    }
    
    // Yerel ses parçasının durumunu kontrol et
    const localAudioTrack = localAudioTracks[0];
    console.log("Yerel ses parçası:", localAudioTrack.label, "Etkin:", localAudioTrack.enabled);
    
    if (!localAudioTrack.enabled) {
        console.warn("Yerel ses parçası devre dışı, etkinleştiriliyor");
        localAudioTrack.enabled = true;
        showNotification("Mikrofon etkinleştirildi", "success");
    }
    
    // Uzak akış kontrolü
    if (!remoteStream) {
        console.error("Uzak akış mevcut değil");
        showNotification("Karşı taraftan ses alınamıyor.", "error");
        return;
    }
    
    // Uzak ses parçalarını kontrol et
    const remoteAudioTracks = remoteStream.getAudioTracks();
    if (remoteAudioTracks.length === 0) {
        console.error("Uzak ses parçası bulunamadı");
        showNotification("Karşı taraftan ses parçası alınamıyor.", "error");
        return;
    }
    
    // Uzak ses parçasının durumunu kontrol et
    const remoteAudioTrack = remoteAudioTracks[0];
    console.log("Uzak ses parçası:", remoteAudioTrack.label, "Etkin:", remoteAudioTrack.enabled);
    
    if (!remoteAudioTrack.enabled) {
        console.warn("Uzak ses parçası devre dışı");
        showNotification("Karşı tarafın sesi devre dışı.", "warning");
    }
    
    // Audio element kontrolü
    if (!remoteAudio.srcObject) {
        console.error("Audio element'e akış bağlanmamış");
        showNotification("Ses akışı audio element'e bağlanıyor...", "warning");
        remoteAudio.srcObject = remoteStream;
    }
    
    // Ses seviyesi kontrolü
    if (remoteAudio.volume !== 1.0) {
        console.warn("Ses seviyesi maksimumda değil");
        showNotification("Ses seviyesi maksimuma ayarlanıyor...", "warning");
        remoteAudio.volume = 1.0;
        volumeControl.value = 1.0;
        volumeValue.textContent = "100%";
    }
    
    // Audio element'i oynatmaya zorla
    try {
        await remoteAudio.play();
        showNotification("Ses oynatma yeniden başlatıldı");
    } catch (error) {
        console.error("Ses oynatılamadı:", error);
        showNotification("Ses oynatılamadı: " + error.message, "error");
    }
    
    // Ses çıkış cihazını kontrol et ve ayarla
    try {
        // Tarayıcı desteğini kontrol et
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
            
            console.log("Kullanılabilir ses çıkış cihazları:", audioOutputDevices);
            
            if (audioOutputDevices.length > 0) {
                // Varsayılan hoparlörü seç (genellikle ilk cihaz)
                const defaultSpeaker = audioOutputDevices[0];
                
                // Ses elementine çıkış cihazını ayarla (sinkId API'si)
                if (typeof remoteAudio.setSinkId === 'function') {
                    await remoteAudio.setSinkId(defaultSpeaker.deviceId);
                    console.log("Ses çıkış cihazı ayarlandı:", defaultSpeaker.label);
                    showNotification("Ses çıkışı hoparlöre yönlendirildi: " + defaultSpeaker.label);
                } else {
                    console.warn("setSinkId API'si desteklenmiyor. Varsayılan ses çıkışı kullanılacak.");
                    showNotification("Tarayıcınız ses çıkış cihazı seçimini desteklemiyor. Sistem ayarlarından hoparlörü seçin.", "warning");
                }
            } else {
                console.warn("Ses çıkış cihazı bulunamadı");
                showNotification("Ses çıkış cihazı bulunamadı. Sistem ayarlarını kontrol edin.", "warning");
            }
        }
    } catch (error) {
        console.error("Ses çıkış cihazı ayarlanamadı:", error);
    }
    
    // PeerConnection durumunu kontrol et
    if (peerConnection) {
        console.log("Bağlantı durumu:", peerConnection.connectionState);
        console.log("ICE bağlantı durumu:", peerConnection.iceConnectionState);
        console.log("Sinyalleşme durumu:", peerConnection.signalingState);
        
        if (peerConnection.connectionState !== "connected") {
            console.warn("PeerConnection bağlı değil");
            showNotification("WebRTC bağlantısı kurulu değil.", "warning");
        }
        
        if (peerConnection.iceConnectionState !== "connected" && peerConnection.iceConnectionState !== "completed") {
            console.warn("ICE bağlantısı kurulu değil");
            showNotification("ICE bağlantısı kurulu değil. Ağ ayarlarınızı kontrol edin.", "warning");
        }
    } else {
        console.error("PeerConnection mevcut değil");
        showNotification("WebRTC bağlantısı oluşturulmamış.", "error");
    }
    
    showNotification("Ses akışı kontrol edildi. Hoparlörden ses duymanız gerekiyor.");
}

// Bildirim göster
function showNotification(message, type = "info") {
    console.log(message);
    
    // Bildirim alanı yoksa oluştur
    let notificationArea = document.getElementById('notificationArea');
    if (!notificationArea) {
        notificationArea = document.createElement('div');
        notificationArea.id = 'notificationArea';
        notificationArea.style.position = 'fixed';
        notificationArea.style.bottom = '20px';
        notificationArea.style.right = '20px';
        notificationArea.style.maxWidth = '300px';
        notificationArea.style.zIndex = '1000';
        document.body.appendChild(notificationArea);
    }
    
    // Bildirim oluştur
    const notification = document.createElement('div');
    notification.style.padding = '10px 15px';
    notification.style.marginBottom = '10px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    notification.style.transition = 'all 0.3s ease';
    
    // Bildirim tipine göre stil
    switch (type) {
        case "success":
            notification.style.backgroundColor = '#4CAF50';
            notification.style.color = 'white';
            break;
        case "warning":
            notification.style.backgroundColor = '#FF9800';
            notification.style.color = 'white';
            break;
        case "error":
            notification.style.backgroundColor = '#F44336';
            notification.style.color = 'white';
            break;
        default:
            notification.style.backgroundColor = '#2196F3';
            notification.style.color = 'white';
    }
    
    notification.textContent = message;
    notificationArea.appendChild(notification);
    
    // 5 saniye sonra bildirim kaybolsun
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

// Sayfa yüklendiğinde
window.addEventListener('load', async () => {
    console.log("Sayfa yüklendi");
    
    // Tarayıcı desteğini kontrol et
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tarayıcınız WebRTC'yi desteklemiyor. Lütfen Chrome, Firefox veya Edge gibi modern bir tarayıcı kullanın.");
        return;
    }
    
    // HTTPS kontrolü
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert("WebRTC güvenlik nedeniyle HTTPS gerektirir. Lütfen HTTPS üzerinden erişin.");
    }
    
    // Ses izinlerini iste
    try {
        // Sadece ses izni iste
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // İzin alındıktan sonra akışı kapat
        stream.getTracks().forEach(track => track.stop());
        
        console.log("Ses izinleri alındı");
        
        // Ses cihazlarını listele
        await enumerateAudioDevices();
    } catch (error) {
        console.error("Ses izinleri alınamadı:", error);
    }
    
    // Kullanıcı etkileşimi ile ses oynatma izni al
    document.addEventListener('click', () => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
            remoteAudio.play().catch(error => {
                console.warn("Otomatik oynatma başarısız:", error);
            });
        }
    }, { once: true });
    
    // LocalStorage'dan token kontrolü
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
        tokenInput.value = savedToken;
    }
});

// Hata yakalama
window.onerror = function(message, source, lineno, colno, error) {
    console.error("Yakalanan hata:", message, "Kaynak:", source, "Satır:", lineno, "Sütun:", colno, "Hata:", error);
    showNotification("Bir hata oluştu: " + message, "error");
};

// Tarayıcı kapatıldığında veya sayfa yenilendiğinde
window.addEventListener('beforeunload', () => {
    // Aramayı sonlandır
    endCall();
    
    // Bağlantıyı kapat
    if (connection && connection.state === "Connected") {
        connection.stop();
    }
});

// Tarayıcı görünürlük değiştiğinde
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Sayfa görünür olduğunda bağlantıyı kontrol et
        if (connection && connection.state !== "Connected") {
            startConnection();
        }
    }
});

// Ses çıkış cihazı değişikliklerini dinle
navigator.mediaDevices?.addEventListener('devicechange', async () => {
    console.log("Cihaz değişikliği algılandı");
    await enumerateAudioDevices();
    
    // Aktif bir arama varsa ses çıkışını güncelle
    if (remoteStream) {
        await selectAudioOutput();
    }
});