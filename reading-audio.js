/* Article speech uses Easy Speech 2.4.0 (MIT), loaded only on user request.
   Audio controls never change article DOM, handwriting, or learning completion. */
window.ReadingAudio = (() => {
  const $ = id => document.getElementById(id);
  const key = 'tri-reading-audio-v1';
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  let ready = false, initializing = null, serial = 0, timer = null;
  let mode = 'idle', queue = [], position = 0, articleId = null, source = '';
  let voices = [], selectedVoice = null;
  const rates = [.75, .9, 1, 1.1, 1.25];
  let rate = rates.includes(+preferences.rate) ? +preferences.rate : .9;

  function status(text) { $('readingAudioStatus').textContent = text; }
  function savePreferences() {
    try { localStorage.setItem(key, JSON.stringify({rate, voice: selectedVoice?.voiceURI || ''})); } catch {}
  }
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function update() {
    const active = ['loading', 'starting', 'playing', 'paused'].includes(mode);
    englishSpeechActive = active;
    $('readingAudioPause').disabled = !['starting', 'playing', 'paused'].includes(mode);
    $('readingAudioPause').textContent = mode === 'paused' ? '继续' : '暂停';
    $('readingAudioStop').disabled = !active;
    $('readingAudioPlay').disabled = mode === 'loading';
    $('readingAudioParagraphPlay').disabled = mode === 'loading';
    $('speakEnglishSelection').classList.toggle('is-active', active);
    $('speakEnglishSelection').setAttribute('aria-pressed', String(active));
    $('speechDockState').textContent = active ? '正在听读' : '文章朗读';
    $('readingAudioProgress').textContent = queue.length
      ? '第 ' + Math.min(position + 1, queue.length) + ' / ' + queue.length + ' 个片段'
      : '可播放全文、指定段落或选中的句子';
  }
  function cancelEngine() {
    clearTimer();
    try { if (ready) EasySpeech.cancel(); else window.speechSynthesis?.cancel(); } catch {}
  }
  function stop(message = '') {
    const wasActive = ['loading', 'starting', 'playing', 'paused'].includes(mode);
    serial++;
    mode = 'idle';
    cancelEngine();
    update();
    if (message || wasActive) status(message || '已停止；可以重新播放全文或指定段落。');
  }
  function fail(message) {
    stop(); mode = 'error'; status(message); update();
  }
  function voiceOptions() {
    voices = EasySpeech.voices().filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    selectedVoice = voices.find(v => v.voiceURI === preferences.voice)
      || voices.find(v => v.default) || voices.find(v => /^en[-_]US$/i.test(v.lang)) || voices[0];
    const select = $('readingAudioVoice');
    select.replaceChildren();
    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = voice.name + ' · ' + voice.lang;
      select.append(option);
    }
    select.value = selectedVoice?.voiceURI || '';
    select.disabled = !voices.length;
    if (!voices.length) throw new Error('english-voice-missing');
  }
  async function ensureReady() {
    if (ready) return;
    if (!initializing) initializing = (async () => {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window))
        throw new Error('speech-unsupported');
      await EasySpeech.init({maxTimeout: 5000, interval: 250, maxLengthExceeded: 'error'});
      voiceOptions(); ready = true;
    })().finally(() => { initializing = null; });
    return initializing;
  }
  function errorText(error) {
    const code = error?.error || error?.message || '';
    if (code === 'speech-unsupported') return '此浏览器未提供朗读接口，请换用支持系统朗读的浏览器。';
    if (code === 'english-voice-missing') return '没有检测到英语语音。请检查平板系统的文字转语音设置及英语语音包，再点“检测语音”。';
    if (/voices|timeout/i.test(code)) return '暂未加载到系统语音。请检查系统朗读设置，稍后点“检测语音”重试。';
    if (code === 'not-allowed') return '浏览器阻止了朗读，请再次点击播放。';
    if (code === 'network') return '语音服务暂时无法连接。请检查网络，或选择其他英语语音。';
    return '朗读暂时失败。请更换英语语音或重新检测后播放；文章和笔迹保持不变。';
  }
  function split(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    let sentences;
    try { sentences = Array.from(new Intl.Segmenter('en', {granularity: 'sentence'}).segment(clean), s => s.segment); }
    catch { sentences = clean.match(/[^.!?]+[.!?]*["'”’]*|[.!?]+/g) || [clean]; }
    const chunks = [];
    for (const sentence of sentences) {
      let chunk = '';
      for (const word of sentence.trim().split(/\s+/)) {
        if (chunk && chunk.length + word.length + 1 > 260) { chunks.push(chunk); chunk = ''; }
        // Extremely long tokens are split as well, without deleting characters.
        if (word.length > 260) {
          if (chunk) { chunks.push(chunk); chunk = ''; }
          for (let i = 0; i < word.length; i += 260) chunks.push(word.slice(i, i + 260));
        } else chunk += (chunk ? ' ' : '') + word;
      }
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }
  function sync() {
    const article = readingForView();
    const previousParagraph = articleId === article.articleIndex ? +$('readingAudioParagraph').value : null;
    if (articleId !== article.articleIndex) { stop(); queue = []; position = 0; source = ''; }
    articleId = article.articleIndex;
    $('readingAudioParagraph').replaceChildren();
    article.paragraphs.forEach((_, index) => {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = '第 ' + (index + 1) + ' 段';
      $('readingAudioParagraph').append(option);
    });
    $('readingAudioParagraph').disabled = !article.loaded;
    $('readingAudioParagraph').value = String(Math.min(previousParagraph ?? (ReadingDesk.ready ? ReadingDesk.record().through || 0 : 0), Math.max(0, article.paragraphs.length - 1)));
    if (!queue.length) $('readingAudioSentence').textContent = '播放时在这里显示当前听读片段，不改变原文与笔迹的位置。';
    update();
  }
  function current(token) {
    return token === serial && !document.hidden && document.getElementById('english').classList.contains('active')
      && !WordMemory.wordsOnly && readingForView().articleIndex === articleId;
  }
  function speakCurrent(token) {
    if (!current(token) || mode === 'paused') return;
    if (position >= queue.length) {
      if ($('readingAudioLoop').checked && source !== 'test') position = 0;
      else { mode = 'ended'; clearTimer(); status('播放结束。这只表示音频已播放，不自动完成阅读或题目。'); update(); return; }
    }
    const text = queue[position];
    let started = false;
    mode = 'starting'; $('readingAudioSentence').textContent = text;
    status(source === 'test' ? '正在测试英语声音…' : '正在准备英语朗读…'); update();
    clearTimer();
    timer = setTimeout(() => {
      if (current(token)) fail(started ? '语音服务中断，请点击播放重试当前段落。' : '语音未能开始。请检查设备媒体音量、网络或更换语音，再点击播放。');
    }, 12000);
    try {
      Promise.resolve(EasySpeech.speak({text, voice: selectedVoice, rate, pitch: 1, volume: 1, infiniteResume: false,
        start() {
          if (!current(token)) { cancelEngine(); return; }
          started = true; mode = 'playing'; clearTimer();
          timer = setTimeout(() => { if (current(token)) fail('本段朗读等待过久，请重新播放或更换语音。'); }, Math.max(20000, text.split(/\s+/).length * 1600 / rate + 8000));
          status(source === 'test' ? '测试句正在播放；请确认你能听到声音。' : '正在朗读；暂停后会从当前句开头继续。'); update();
        }
      })).then(() => {
        if (!current(token) || mode === 'paused') return;
        clearTimer(); position++; speakCurrent(token);
      }).catch(error => { if (current(token) && mode !== 'paused') fail(errorText(error)); });
    } catch (error) { if (current(token)) fail(errorText(error)); }
  }
  async function play(kind = 'article', selection = '') {
    stop(); sync();
    const article = readingForView();
    if (!article.loaded || !article.paragraphs.length) return fail('文章尚未加载，请稍后再播放。');
    let text = '';
    if (kind === 'test') text = 'This is an English reading test. You can listen to one sentence at a time.';
    else if (kind === 'selection') text = selection;
    else if (kind === 'paragraph') text = article.paragraphs[+$('readingAudioParagraph').value] || '';
    else text = article.paragraphs.join(' ');
    queue = split(text); position = 0; source = kind;
    if (!queue.length) return fail('请先在原文中选中一个句子，或选择全文、段落播放。');
    const token = ++serial; mode = 'loading'; status('正在检测并加载系统英语语音…'); update();
    try { await ensureReady(); if (current(token)) speakCurrent(token); }
    catch (error) { if (token === serial) fail(errorText(error)); }
  }
  async function check() {
    stop(); const token = ++serial; mode = 'loading'; status('正在检测系统英语语音…'); update();
    try {
      if (ready) voiceOptions(); else await ensureReady();
      if (token !== serial) return;
      mode = 'idle'; status('已检测到 ' + voices.length + ' 个英语语音。点击“试听”确认声音与音量。'); update();
    } catch (error) { if (token === serial) fail(errorText(error)); }
  }
  function pause() {
    if (mode === 'paused') { const token = ++serial; mode = 'starting'; speakCurrent(token); return; }
    if (!['starting', 'playing'].includes(mode)) return;
    serial++; mode = 'paused'; cancelEngine();
    status('已暂停；继续时从当前句开头播放，不跳过内容。'); update();
  }
  function restartIfActive() {
    if (['starting', 'playing'].includes(mode)) { serial++; cancelEngine(); speakCurrent(serial); }
  }
  $('readingAudioRate').value = String(rate);
  $('readingAudioRate').onchange = event => { rate = +event.target.value; savePreferences(); restartIfActive(); };
  $('readingAudioVoice').onchange = event => {
    selectedVoice = voices.find(v => v.voiceURI === event.target.value) || voices[0];
    preferences.voice = selectedVoice?.voiceURI || ''; savePreferences(); restartIfActive();
  };
  $('readingAudioPause').onclick = pause;
  $('readingAudioStop').onclick = () => stop();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['starting', 'playing'].includes(mode)) pause();
    else if (document.hidden && mode === 'loading') stop('已停止加载；返回页面后点击播放。');
  });
  window.addEventListener('pagehide', () => stop());
  sync();
  return {play, check, stop, sync, split, pause, state: () => ({mode, position, count: queue.length, articleId, source, rate, voices: voices.length})};
})();
