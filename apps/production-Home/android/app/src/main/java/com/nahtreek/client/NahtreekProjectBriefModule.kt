package com.nahtreek.client

import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

class NahtreekProjectBriefModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  private val writer = Executors.newSingleThreadExecutor()

  override fun getName() = "NahtreekProjectBrief"

  @ReactMethod
  fun createAndShare(payload: String, promise: Promise) {
    if (payload.length > 100_000) {
      promise.reject("PROJECT_BRIEF_TOO_LARGE", "This project brief is too large to export.")
      return
    }
    writer.execute {
      try {
        val file = createPdf(JSONObject(payload))
        val activity = currentActivity
            ?: throw IllegalStateException("Open the project plan and try saving it again.")
        activity.runOnUiThread {
          try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.projectbriefs",
                file,
            )
            val send = Intent(Intent.ACTION_SEND)
                .setType("application/pdf")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(send, "Save or share project brief"))
            promise.resolve(Arguments.createMap().apply {
              putString("uri", uri.toString())
              putString("fileName", file.name)
            })
          } catch (error: Exception) {
            promise.reject("PROJECT_BRIEF_SHARE", "The brief was created but could not be opened for sharing.", error)
          }
        }
      } catch (error: Exception) {
        promise.reject("PROJECT_BRIEF_CREATE", "Could not create the project brief. Please try again.", error)
      }
    }
  }

  private fun createPdf(data: JSONObject): File {
    val directory = File(context.cacheDir, "project-briefs").apply { mkdirs() }
    val file = File(directory, "NAHTREEK_Project_Brief_${System.currentTimeMillis()}.pdf")
    val document = PdfDocument()
    val width = 595
    val height = 842
    val margin = 44f
    var pageNumber = 1
    var page = document.startPage(PdfDocument.PageInfo.Builder(width, height, pageNumber).create())
    var canvas = page.canvas
    var y = margin

    val heading = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(17, 31, 53); textSize = 21f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    val section = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(15, 118, 110); textSize = 13f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(52, 64, 84); textSize = 10.5f; typeface = android.graphics.Typeface.DEFAULT }
    val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(102, 112, 133); textSize = 8.5f; typeface = android.graphics.Typeface.DEFAULT }
    val rule = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(196, 166, 57); strokeWidth = 3f }

    fun finishPage() {
      canvas.drawLine(margin, height - 32f, width - margin, height - 32f, rule)
      canvas.drawText("NAHTREEK HOME - Project Brief", margin, height - 17f, small)
      canvas.drawText("Page $pageNumber", width - margin - 34f, height - 17f, small)
      document.finishPage(page)
    }
    fun newPage() {
      finishPage()
      pageNumber += 1
      page = document.startPage(PdfDocument.PageInfo.Builder(width, height, pageNumber).create())
      canvas = page.canvas
      y = margin
    }
    fun ensure(space: Float) {
      if (y + space > height - 54f) newPage()
    }
    fun lines(text: String, paint: Paint, available: Float): List<String> {
      val result = mutableListOf<String>()
      var line = ""
      text.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.forEach { word ->
        val candidate = if (line.isBlank()) word else "$line $word"
        if (paint.measureText(candidate) <= available || line.isBlank()) line = candidate
        else { result.add(line); line = word }
      }
      if (line.isNotBlank()) result.add(line)
      return result.ifEmpty { listOf("") }
    }
    fun paragraph(text: String, indent: Float = 0f) {
      lines(text, body, width - margin * 2 - indent).forEach { line ->
        ensure(16f)
        canvas.drawText(line, margin + indent, y, body)
        y += 15f
      }
      y += 5f
    }
    fun sectionTitle(title: String) {
      ensure(28f)
      canvas.drawText(title, margin, y, section)
      y += 20f
    }
    fun bullets(values: List<String>) {
      values.forEach { value ->
        val wrapped = lines(value, body, width - margin * 2 - 16f)
        wrapped.forEachIndexed { index, line ->
          ensure(16f)
          if (index == 0) canvas.drawCircle(margin + 4f, y - 4f, 2.5f, rule)
          canvas.drawText(line, margin + 14f, y, body)
          y += 15f
        }
        y += 2f
      }
    }
    fun arrayStrings(key: String): List<String> {
      val array = data.optJSONArray(key) ?: return emptyList()
      return (0 until array.length()).mapNotNull { index -> array.optString(index).takeIf { it.isNotBlank() } }
    }

    canvas.drawText("NAHTREEK", margin, y, section)
    y += 29f
    canvas.drawText(data.optString("title", "Project brief"), margin, y, heading)
    y += 23f
    val client = data.optString("clientName")
    val city = data.optString("city")
    if (client.isNotBlank() || city.isNotBlank()) {
      canvas.drawText(listOf(client, city).filter { it.isNotBlank() }.joinToString(" - "), margin, y, small)
      y += 21f
    }
    sectionTitle("Project overview")
    paragraph(data.optString("summary", "Your saved NAHTREEK project plan."))

    sectionTitle("What to do now")
    val stages = data.optJSONArray("stages") ?: JSONArray()
    if (stages.length() == 0) paragraph("Review your project details and choose the next action that fits your situation.")
    for (index in 0 until stages.length()) {
      val stage = stages.optJSONObject(index) ?: continue
      val stageTitle = stage.optString("title")
      val detail = stage.optString("detail")
      if (stageTitle.isNotBlank()) {
        ensure(18f)
        canvas.drawText("${index + 1}. $stageTitle", margin, y, body.apply { typeface = android.graphics.Typeface.DEFAULT_BOLD })
        body.typeface = android.graphics.Typeface.DEFAULT
        y += 15f
      }
      if (detail.isNotBlank()) paragraph(detail, 10f)
    }

    sectionTitle("Checklist")
    bullets(arrayStrings("checklist"))
    sectionTitle("Questions for your professional")
    bullets(listOf(
        "What is included and excluded in the proposed scope?",
        "What must be checked before work begins?",
        "What timeline, access, approvals, or materials could affect the plan?",
    ))
    val unknowns = arrayStrings("missingInformation")
    if (unknowns.isNotEmpty()) {
      sectionTitle("Still useful to confirm")
      bullets(unknowns)
    }
    sectionTitle("Important note")
    paragraph(data.optString("safetyNote", "A qualified professional must review structural, electrical, legal, and approval decisions before work starts."))

    finishPage()
    FileOutputStream(file).use { document.writeTo(it) }
    document.close()
    return file
  }
}

class NahtreekProjectBriefPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(NahtreekProjectBriefModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
