/* voice.js — голосові канали: WebRTC-аудіо P2P, сигналінг через сервер (SSE) */
'use strict';

/* ---------- «хто говорить»: аналіз гучності потоків ---------- */
const Speak = (function () {
  let ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  const analysers = {};
  const levels = {};
  let timer = null;

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
  }

  function start(id, stream) {
    stop(id);
    if (!ctx || !stream) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.4;
      src.connect(an);
      analysers[id] = an;
    } catch (e) { return; }
    resume();
    if (!timer) timer = setInterval(tick, 120);
  }

  function tick() {
    let changed = false;
    Object.keys(analysers).forEach(function (id) {
      const an = analysers[id];
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const on = (sum / (data.length * 255)) > 0.1;
      if ((levels[id] === 1) !== on) changed = true;
      levels[id] = on ? 1 : 0;
    });
    if (changed && typeof onSpeakChange === 'function') onSpeakChange(levels);
  }

  function stop(id) {
    if (analysers[id]) { try { analysers[id].disconnect(); } catch (e) {} delete analysers[id]; }
    delete levels[id];
  }

  function isSpeaking(id) { return levels[id] === 1; }
  return { start: start, stop: stop, isSpeaking: isSpeaking, levels: levels };
})();

const Voice = {
  channel: null,
  serverId: null,
  stream: null,
  pcs: {},            // userId -> RTCPeerConnection
  audio: {},          // userId -> HTMLAudioElement
  pending: {},        // userId -> [candidate]
  videoStreams: { share: null, cam: null }, // локальні відеопотоки
  remoteVideo: {},    // userId -> MediaStream (екран/камера співрозмовника)
  muted: false,
  deafened: false,

  isIn: function (chanId) { return this.channel === chanId; },

  join: async function (channelId, serverId) {
    if (this.channel === channelId) return;
    if (this.channel) await this.leave(true);
    this.channel = channelId;
    this.serverId = serverId || null;
    renderSidebar();
    renderVoiceBar();

    /* мікрофон (якщо відмовили — просто слухаємо) */
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      this.stream = null;
      toast('Немає доступу до мікрофона — режим прослуховування', 'warn');
    }
    this.applyMute();
    Speak.start('me', this.stream);

    let peers = [];
    try {
      const r = await api('POST', '/voice', { channel: channelId });
      peers = r.peers || [];
    } catch (e) { toast(e.message, 'err'); }

    for (const pid of peers) this.makeOffer(pid);
    playSound('join');
    renderVoiceBar();
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
  },

  makeOffer: async function (peerId) {
    if (this.pcs[peerId]) return;
    const pc = this.createPc(peerId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await api('POST', '/voice/signal', { to: peerId, data: { sdp: pc.localDescription } });
    } catch (e) {}
  },

  createPc: function (peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    this.pcs[peerId] = pc;
    if (this.stream) this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
    const share = this.videoStreams.share;
    if (share) share.getTracks().forEach(t => pc.addTrack(t, share));
    const cam = this.videoStreams.cam;
    if (cam) cam.getTracks().forEach(t => pc.addTrack(t, cam));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        api('POST', '/voice/signal', { to: peerId, data: { candidate: e.candidate } }).catch(function () {});
      }
    };
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        e.track.onended = () => { delete this.remoteVideo[peerId]; if (typeof refreshVoiceUI === 'function') refreshVoiceUI(); };
        this.attachRemoteVideo(peerId, e.streams[0]);
      } else {
        this.attachAudio(peerId, e.streams[0]);
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && this.pcs[peerId]) {
        /* disconnected може бути тимчасовим — прибираємо лише за failed/closed */
        if (pc.connectionState !== 'disconnected') this.dropPeer(peerId);
      }
    };
    return pc;
  },

  attachRemoteVideo: function (peerId, stream) {
    this.remoteVideo[peerId] = stream;
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
  },

  renegotiate: async function (peerId) {
    const pc = this.pcs[peerId];
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await api('POST', '/voice/signal', { to: peerId, data: { sdp: pc.localDescription } });
    } catch (e) {}
  },

  /* kind: 'share' (демонстрація екрана) або 'cam' (камера) */
  startVideo: async function (kind) {
    if (this.videoStreams[kind]) return;
    let stream = null;
    try {
      if (kind === 'share') stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      else stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    } catch (e) {
      toast(kind === 'share' ? 'Демонстрацію скасовано' : 'Немає доступу до камери', 'warn');
      return;
    }
    this.videoStreams[kind] = stream;
    const vt = stream.getVideoTracks()[0];
    if (vt && kind === 'share') vt.onended = () => this.stopVideo('share');
    Object.keys(this.pcs).forEach(pid => {
      const pc = this.pcs[pid];
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      this.renegotiate(pid);
    });
    api('POST', '/voice/state', kind === 'share' ? { share: true } : { cam: true }).catch(function () {});
    if (kind === 'share') playSound('shareOn');
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
    toast(kind === 'share' ? 'Демонстрацію екрана увімкнено' : 'Камеру увімкнено');
  },

  stopVideo: async function (kind) {
    const stream = this.videoStreams[kind];
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
    this.videoStreams[kind] = null;
    Object.keys(this.pcs).forEach(pid => {
      const pc = this.pcs[pid];
      stream.getTracks().forEach(t => {
        const sender = pc.getSenders().find(s => s.track === t);
        if (sender) { try { pc.removeTrack(sender); } catch (e) {} }
      });
      this.renegotiate(pid);
    });
    api('POST', '/voice/state', kind === 'share' ? { share: false } : { cam: false }).catch(function () {});
    if (kind === 'share') playSound('shareOff');
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
  },

  attachAudio: function (peerId, stream) {
    let a = this.audio[peerId];
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true;
      a.className = 'remote-audio';
      document.body.appendChild(a);
      this.audio[peerId] = a;
    }
    a.srcObject = stream;
    a.muted = this.deafened;
    a.play().catch(function () {});
    Speak.start(peerId, stream);
  },

  dropPeer: function (peerId) {
    const pc = this.pcs[peerId];
    if (pc) { try { pc.close(); } catch (e) {} delete this.pcs[peerId]; }
    const a = this.audio[peerId];
    if (a) { a.srcObject = null; a.remove(); delete this.audio[peerId]; }
    delete this.remoteVideo[peerId];
    Speak.stop(peerId);
    this.pending[peerId] = [];
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
  },

  takeSignal: async function (from, data) {
    if (!this.channel) return;
    if (data.sdp) {
      let pc = this.pcs[from];
      if (!pc) pc = this.createPc(from);
      try {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          await api('POST', '/voice/signal', { to: from, data: { sdp: pc.localDescription } });
        }
      } catch (e) {}
      (this.pending[from] || []).forEach(c => pc.addIceCandidate(c).catch(function () {}));
      this.pending[from] = [];
    } else if (data.candidate) {
      const pc = this.pcs[from];
      if (pc && pc.remoteDescription) pc.addIceCandidate(data.candidate).catch(function () {});
      else {
        (this.pending[from] = this.pending[from] || []).push(data.candidate);
      }
    }
  },

  /* хтось приєднався до мого каналу — на випадок гонки робимо власну пропозицію */
  onPeerJoined: function (userId, channelId) {
    if (!this.channel || this.channel !== channelId) return;
    if (this.pcs[userId]) return;
    setTimeout(() => {
      if (this.channel === channelId && !this.pcs[userId]) this.makeOffer(userId);
    }, 1500);
  },

  onPeerLeft: function (userId) { this.dropPeer(userId); },

  leave: async function (silent) {
    const chan = this.channel;
    this.channel = null;
    this.serverId = null;
    Object.keys(this.pcs).forEach(id => this.dropPeer(id));
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    Object.keys(this.videoStreams).forEach(k => {
      const s = this.videoStreams[k];
      if (s) s.getTracks().forEach(t => t.stop());
      this.videoStreams[k] = null;
    });
    this.remoteVideo = {};
    Object.keys(Speak.levels).forEach(function (id) { Speak.stop(id); });
    Speak.stop('me');
    if (chan && !silent) {
      try { await api('POST', '/voice', { channel: chan, action: 'leave' }); } catch (e) {}
      playSound('leave');
    }
    renderSidebar();
    renderVoiceBar();
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
    if (typeof renderChatHeader === 'function' && S.view.type === 'server') renderChatHeader();
  },

  applyMute: function () {
    if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
  },

  toggleMute: function () {
    this.muted = !this.muted;
    /* увімкнення мікрофона знімає глушіння загального звуку */
    if (!this.muted && this.deafened) {
      this.deafened = false;
      Object.keys(this.audio).forEach(id => { this.audio[id].muted = false; });
    }
    this.applyMute();
    playSound(this.muted ? 'mute' : 'unmute');
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI(); else renderVoiceBar();
    renderSidebar();
  },

  toggleDeafen: function () {
    this.deafened = !this.deafened;
    /* глушіння загального звуку вимикає й мікрофон (як у Discord) */
    this.muted = this.deafened;
    this.applyMute();
    Object.keys(this.audio).forEach(id => { this.audio[id].muted = this.deafened; });
    if (this.deafened) {
      playSound('mute');    /* звук вимкнення мікрофона */
      playSound('deafen');  /* звук вимкнення загального звуку */
    } else {
      playSound('unmute');
      playSound('undeafen');
    }
    if (typeof refreshVoiceUI === 'function') refreshVoiceUI(); else renderVoiceBar();
    renderSidebar();
  }
};

/* реакції на події каналу */
on('voice.signal', d => Voice.takeSignal(d.from, d.data));
on('voice.join', d => { Voice.onPeerJoined(d.userId, d.channel); if (d.userId !== S.me.id && Voice.channel === d.channel) playSound('userJoin'); renderSidebar(); });
on('voice.leave', d => { Voice.onPeerLeft(d.userId); if (d.userId !== S.me.id && Voice.channel === d.channel) playSound('userLeave'); renderSidebar(); });
on('voice.state', d => {
  const p = S.presences[d.userId];
  if (p) p.voice = d.voice;
  if (typeof refreshVoiceUI === 'function') refreshVoiceUI();
  if (typeof renderSidebar === 'function') renderSidebar();
});
