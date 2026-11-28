package app.thirstr.ask

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// F-24 R-24.1, R-24.3 (#346): Ask engine 2 (Gemini Nano via ML Kit GenAI Prompt API, on-device)
// and on-device dictation (SpeechRecognizer.createOnDeviceSpeechRecognizer, API 31+). The text
// and the audio never leave the phone; without on-device support both report unsupported.
class ThirstrAskModule : Module() {
  private val model: GenerativeModel by lazy { Generation.getClient() }
  private var recognizer: SpeechRecognizer? = null
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("ThirstrAsk")
    Events("onSpeech", "onSpeechEnd")

    AsyncFunction("engine") Coroutine { ->
      try {
        if (model.checkStatus() == FeatureStatus.AVAILABLE) "nano" else null
      } catch (e: Exception) {
        null
      }
    }

    AsyncFunction("parse") Coroutine { text: String, instructions: String ->
      val prompt = "$instructions\n\nSearch: $text\nJSON:"
      val res = model.generateContent(
        generateContentRequest(TextPart(prompt)) {
          temperature = 0f
          topK = 1
          maxOutputTokens = 256
        },
      )
      res.candidates.firstOrNull()?.text ?: "{}"
    }

    Function("speechSupported") { _: String ->
      val ctx = appContext.reactContext ?: return@Function false
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
    }

    AsyncFunction("listen") { lang: String, promise: Promise ->
      val perms = appContext.permissions
      if (perms == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      perms.askForPermissions({ result ->
        val ok = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
        if (!ok) {
          promise.resolve(false)
        } else {
          main.post { promise.resolve(start(lang)) }
        }
      }, Manifest.permission.RECORD_AUDIO)
    }

    Function("stop") {
      main.post { recognizer?.stopListening() }
    }

    OnDestroy {
      main.post { end(null) }
    }
  }

  private fun start(lang: String): Boolean {
    val ctx = appContext.reactContext ?: return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) return false
    end(null)
    val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
    recognizer = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
      override fun onPartialResults(partial: Bundle?) {
        first(partial)?.let { sendEvent("onSpeech", mapOf("text" to it, "final" to false)) }
      }
      override fun onResults(results: Bundle?) {
        first(results)?.let { sendEvent("onSpeech", mapOf("text" to it, "final" to true)) }
        end(null)
      }
      override fun onError(error: Int) {
        end("speech_$error")
      }
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    }
    r.startListening(intent)
    return true
  }

  private fun first(b: Bundle?): String? = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  private fun end(error: String?) {
    val r = recognizer ?: return
    recognizer = null
    r.destroy()
    sendEvent("onSpeechEnd", if (error == null) emptyMap<String, Any>() else mapOf("error" to error))
  }
}
