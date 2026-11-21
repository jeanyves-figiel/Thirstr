package app.thirstr.translate

import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// F-07 R-07.25–R-07.29 (#107): chat translation on the phone only, same JS API as iOS.
// Detection: ML Kit Language ID (bundled model). Translation: ML Kit Translation (on-device models).
// No text is sent anywhere; only language models download from Google, never silently:
// `translate` is called for a missing pack only after the user taps the chip (R-07.29).
class ThirstrTranslateModule : Module() {
  // Any confidence is passed through; translate.ts applies the 0.6 threshold (R-07.26).
  private val identifier by lazy {
    LanguageIdentification.getClient(LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.01f).build())
  }
  private val models by lazy { RemoteModelManager.getInstance() }
  // One open translator per pair; few pairs per phone, closed with the module.
  private val translators = HashMap<String, Translator>()

  override fun definition() = ModuleDefinition {
    Name("ThirstrTranslate")

    Function("supported") { true }

    // Best language guess with its probability; empty when unsure or romanized (e.g. "hi-Latn").
    AsyncFunction("detect") { text: String, promise: Promise ->
      identifier.identifyPossibleLanguages(text)
        .addOnSuccessListener { list ->
          val best = list.maxByOrNull { it.confidence }
          if (best == null || best.languageTag == "und" || best.languageTag.contains("-")) {
            promise.resolve(emptyMap<String, Any>())
          } else {
            promise.resolve(mapOf("lang" to base(best.languageTag), "p" to best.confidence.toDouble()))
          }
        }
        .addOnFailureListener { promise.resolve(emptyMap<String, Any>()) }
    }

    // "installed" (both models on the phone) | "supported" (needs a download) | "unsupported"
    AsyncFunction("status") { from: String, to: String, promise: Promise ->
      val pair = pair(from, to)
      if (pair == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      models.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { have ->
          val langs = have.map { it.language }.toSet()
          promise.resolve(if (langs.contains(pair.first) && langs.contains(pair.second)) "installed" else "supported")
        }
        .addOnFailureListener { promise.resolve("unsupported") }
    }

    // Translates a batch for one pair, downloading missing models first (any network: the user
    // tapped "Translate ‹language›", whose caption announces the one-time download).
    AsyncFunction("translate") { texts: List<String>, from: String, to: String, promise: Promise ->
      val pair = pair(from, to)
      if (pair == null) {
        promise.reject("E_UNSUPPORTED", "Language pair not supported", null)
        return@AsyncFunction
      }
      val t = translator(pair.first, pair.second)
      t.downloadModelIfNeeded(DownloadConditions.Builder().build())
        .onSuccessTask { Tasks.whenAllSuccess<String>(texts.map { s -> t.translate(s) }) }
        .addOnSuccessListener { out -> promise.resolve(out) }
        .addOnFailureListener { e -> promise.reject("E_TRANSLATE", e.message ?: "Translation failed", e) }
    }

    OnDestroy {
      synchronized(translators) {
        translators.values.forEach { it.close() }
        translators.clear()
      }
    }
  }

  /** ML Kit language codes for a pair, or null when either side has no model. */
  private fun pair(from: String, to: String): Pair<String, String>? {
    val a = TranslateLanguage.fromLanguageTag(base(from)) ?: return null
    val b = TranslateLanguage.fromLanguageTag(base(to)) ?: return null
    return if (a == b) null else a to b
  }

  /** Base language, with the legacy codes Language ID can return mapped to ML Kit's (iw → he). */
  private fun base(tag: String): String {
    val b = tag.split('-', '_')[0].lowercase()
    return LEGACY[b] ?: b
  }

  private companion object {
    val LEGACY = mapOf("iw" to "he", "in" to "id", "ji" to "yi", "fil" to "tl")
  }

  private fun translator(from: String, to: String): Translator = synchronized(translators) {
    translators.getOrPut("$from>$to") {
      Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build())
    }
  }
}
