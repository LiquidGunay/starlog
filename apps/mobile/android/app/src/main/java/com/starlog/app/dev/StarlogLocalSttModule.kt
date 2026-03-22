package com.starlog.app.dev

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

class StarlogLocalSttModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var speechRecognizer: SpeechRecognizer? = null
  private var pendingPromise: Promise? = null

  override fun getName(): String = "StarlogLocalStt"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactApplicationContext))
  }

  @ReactMethod
  fun getCurrentIntentUrl(promise: Promise) {
    promise.resolve(StarlogIntentStore.currentIntentUrl() ?: currentActivity?.intent?.dataString)
  }

  @ReactMethod
  fun clearCurrentIntentUrl(promise: Promise) {
    StarlogIntentStore.clear()
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }

    val updatedIntent = activity.intent ?: Intent()
    updatedIntent.data = null
    if (updatedIntent.action == Intent.ACTION_VIEW) {
      updatedIntent.action = Intent.ACTION_MAIN
    }
    activity.intent = updatedIntent
    promise.resolve(true)
  }

  @ReactMethod
  fun recognizeOnce(options: ReadableMap?, promise: Promise) {
    if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
      promise.reject("stt_unavailable", "Android speech recognition is unavailable on this device.")
      return
    }
    if (pendingPromise != null) {
      promise.reject("stt_busy", "Another on-device speech recognition request is already running.")
      return
    }

    pendingPromise = promise
    val locale = options?.takeIf { it.hasKey("locale") && !it.isNull("locale") }?.getString("locale")?.trim().orEmpty()
    val prompt = options?.takeIf { it.hasKey("prompt") && !it.isNull("prompt") }?.getString("prompt")?.trim().orEmpty()
    val partialResults = options?.takeIf { it.hasKey("partialResults") && !it.isNull("partialResults") }?.getBoolean("partialResults") ?: false

    mainHandler.post {
      cleanupRecognizer()

      val recognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext)
      speechRecognizer = recognizer
      recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
        override fun onPartialResults(partialResults: Bundle?) = Unit

        override fun onResults(results: Bundle?) {
          val phrases = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
          val transcript = phrases.firstOrNull()?.trim().orEmpty()
          if (transcript.isBlank()) {
            failPending("stt_empty", "Android speech recognition returned no transcript.")
            return
          }

          val payload = Arguments.createMap().apply {
            putString("provider", "android_speech_recognizer")
            putString("transcript", transcript)
            putString("locale", if (locale.isBlank()) null else locale)
            putArray(
              "alternatives",
              Arguments.createArray().apply {
                phrases.forEach { pushString(it) }
              },
            )
            val confidenceScores = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
            if (confidenceScores != null && confidenceScores.isNotEmpty()) {
              putDouble("confidence", confidenceScores[0].toDouble())
            } else {
              putNull("confidence")
            }
          }
          resolvePending(payload)
        }

        override fun onError(error: Int) {
          failPending(errorCode(error), errorMessage(error))
        }
      })

      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults)
        if (locale.isNotBlank()) {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
        }
        if (prompt.isNotBlank()) {
          putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        }
      }
      recognizer.startListening(intent)
    }
  }

  override fun invalidate() {
    super.invalidate()
    mainHandler.post {
      failPending("stt_cancelled", "Android speech recognition was interrupted.")
      cleanupRecognizer()
    }
  }

  private fun resolvePending(payload: WritableMap) {
    val promise = pendingPromise
    pendingPromise = null
    cleanupRecognizer()
    promise?.resolve(payload)
  }

  private fun failPending(code: String, message: String) {
    val promise = pendingPromise
    pendingPromise = null
    cleanupRecognizer()
    promise?.reject(code, message)
  }

  private fun cleanupRecognizer() {
    speechRecognizer?.setRecognitionListener(null)
    speechRecognizer?.destroy()
    speechRecognizer = null
  }

  private fun errorCode(error: Int): String {
    return when (error) {
      SpeechRecognizer.ERROR_AUDIO -> "stt_audio"
      SpeechRecognizer.ERROR_CLIENT -> "stt_client"
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "stt_permission"
      SpeechRecognizer.ERROR_NETWORK -> "stt_network"
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "stt_network_timeout"
      SpeechRecognizer.ERROR_NO_MATCH -> "stt_no_match"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "stt_busy"
      SpeechRecognizer.ERROR_SERVER -> "stt_server"
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "stt_timeout"
      else -> "stt_unknown"
    }
  }

  private fun errorMessage(error: Int): String {
    return when (error) {
      SpeechRecognizer.ERROR_AUDIO -> "Speech recognition audio capture failed."
      SpeechRecognizer.ERROR_CLIENT -> "Speech recognition client error."
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Speech recognition needs microphone permission."
      SpeechRecognizer.ERROR_NETWORK -> "Speech recognition network error."
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout."
      SpeechRecognizer.ERROR_NO_MATCH -> "Speech recognition heard audio but did not detect words."
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognition is already busy."
      SpeechRecognizer.ERROR_SERVER -> "Speech recognition server error."
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech recognition timed out waiting for speech."
      else -> "Speech recognition failed."
    }
  }
}
