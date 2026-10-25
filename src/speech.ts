import type { State } from './model.ts'
let currentAudio: HTMLAudioElement | undefined
let cancel: (() => void) | undefined
let generation = 0
export function englishVoices(): SpeechSynthesisVoice[] {
  return (window.speechSynthesis?.getVoices() ?? []).filter((v) => /^en[-_]/i.test(v.lang))
}
export function selectedVoice(settings: State['settings']) {
  const voices = englishVoices()
  return (
    voices.find((v) => v.voiceURI === settings.voiceURI) ??
    voices.find((v) => v.lang === 'en-GB') ??
    voices[0]
  )
}
export function stopSpeech() {
  generation++
  cancel?.()
  cancel = undefined
  currentAudio?.pause()
  currentAudio = undefined
  window.speechSynthesis?.cancel()
}
export async function speak(
  text: string,
  settings: State['settings'],
  audioUrl = '',
): Promise<void> {
  stopSpeech()
  const ownGeneration = generation
  function play(kind: 'audio' | 'tts'): Promise<void> {
    return new Promise((resolve, reject) => {
      let finished = false
      const done = (error?: Error) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (ownGeneration === generation) cancel = undefined
        error ? reject(error) : resolve()
      }
      const timer = setTimeout(() => {
        currentAudio?.pause()
        window.speechSynthesis?.cancel()
        done(new Error('播放超时，请重试或更换英语音色。'))
      }, 30000)
      cancel = () => done(new Error('播放已停止。'))
      if (kind === 'audio') {
        const audio = new Audio(audioUrl)
        currentAudio = audio
        audio.playbackRate = settings.speed
        audio.onended = () => done()
        audio.onerror = () => done(new Error('配套音频暂不可用。'))
        audio.play().catch(() => done(new Error('音频播放失败，请再次点击播放。')))
      } else {
        const voice = selectedVoice(settings)
        if (!voice || !window.speechSynthesis) {
          done(new Error('当前设备没有可用的英语音色，请先在设置中检查英语语音。'))
          return
        }
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.voice = voice
        utterance.lang = voice.lang
        utterance.rate = settings.speed
        utterance.onend = () => done()
        utterance.onerror = () => done(new Error('英语语音播放失败，请重试或选择其他音色。'))
        window.speechSynthesis.speak(utterance)
      }
    })
  }
  if (audioUrl) {
    try {
      await play('audio')
      return
    } catch (error) {
      if (ownGeneration !== generation) throw error
      currentAudio?.pause()
    }
  }
  if (!englishVoices().length && window.speechSynthesis)
    await new Promise((resolve) => setTimeout(resolve, 700))
  if (ownGeneration !== generation) throw new Error('播放已停止。')
  await play('tts')
}
