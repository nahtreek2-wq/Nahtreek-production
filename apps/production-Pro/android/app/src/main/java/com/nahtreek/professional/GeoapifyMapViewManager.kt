package com.nahtreek.professional

import android.graphics.Color
import android.content.Intent
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import org.json.JSONObject

class GeoapifyMapWebView(context: ThemedReactContext) : WebView(context) {
  var latitude: Double? = null
  var longitude: Double? = null
  private var rendered: Pair<Double, Double>? = null

  init {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    isVerticalScrollBarEnabled = false
    setBackgroundColor(Color.WHITE)
    webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
        val uri = android.net.Uri.parse(url)
        if (uri.scheme == "https" && uri.host in listOf("www.geoapify.com", "www.openstreetmap.org")) {
          runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
        return true
      }
    }
  }

  private fun assetText(name: String): String {
    // Leaflet ships inside the app (no CDN): the map stays interactive on
    // any network. Missing assets degrade to the static fallback below.
    return try { context.assets.open(name).bufferedReader().use { it.readText() } } catch (e: Exception) { "" }
  }

  fun showLocation() {
    val lat = latitude ?: return
    val lon = longitude ?: return
    if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return
    val location = Pair(lat, lon)
    if (rendered == location) return
    rendered = location
    val key = BuildConfig.GEOAPIFY_API_KEY
    val staticMap = android.net.Uri.parse("https://maps.geoapify.com/v1/staticmap").buildUpon()
      .appendQueryParameter("style", "carto")
      .appendQueryParameter("width", "600")
      .appendQueryParameter("height", "800")
      .appendQueryParameter("center", "lonlat:$lon,$lat")
      .appendQueryParameter("zoom", "15")
      .appendQueryParameter("apiKey", key)
      .build().toString()
    val body = if (key.isBlank()) {
      "<div id='message'>Map is not configured in this build.</div>"
    } else {
      """
      <style>${assetText("leaflet.css")}</style>
      <div id="map"></div><div id="fallback"><img id="static-map" alt="Map of the selected address" /><div id="pin"></div></div><div id="message">Loading map…</div>
      <script>${assetText("leaflet.js")}</script>
      <script>
        function showFallback() {
          document.getElementById('map').style.display = 'none';
          document.getElementById('fallback').style.display = 'block';
          var preview = document.getElementById('static-map');
          preview.onload = function() { document.getElementById('message').hidden = true; };
          preview.onerror = function() { document.getElementById('message').textContent = 'Map unavailable. Use Get directions below.'; };
          if (!preview.src) preview.src = ${JSONObject.quote(staticMap)};
        }
        if (typeof L === 'undefined') {
          showFallback();
        } else {
          var lat = $lat, lon = $lon;
          var map = L.map('map', {zoomControl: true, scrollWheelZoom: false}).setView([lat, lon], 16);
          var tiles = L.tileLayer('https://maps.geoapify.com/v1/tile/carto/{z}/{x}/{y}.png?apiKey=' + encodeURIComponent(${JSONObject.quote(key)}), {
            maxZoom: 20,
            attribution: 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>'
          });
          tiles.on('tileerror', function() {
            showFallback();
          });
          tiles.on('tileload', function() { document.getElementById('message').hidden = true; });
          tiles.addTo(map);
          L.circleMarker([lat, lon], {radius: 9, color: '#111F35', weight: 4, fillColor: '#C4A639', fillOpacity: 1}).addTo(map);
        }
      </script>
      """.trimIndent()
    }
    val html = """
      <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      <style>html,body,#map,#fallback{width:100%;height:100%;margin:0}body{font-family:sans-serif;background:#f7f9fc}
      #fallback{display:none;position:relative}#static-map{width:100%;height:100%;object-fit:cover}
      #pin{position:absolute;top:50%;left:50%;width:22px;height:22px;border-radius:50%;background:#C4A639;
      border:4px solid #111F35;box-shadow:0 2px 8px #0005;transform:translate(-50%,-50%)}
      #message{position:absolute;bottom:26px;left:12px;right:12px;padding:12px;border-radius:10px;
      background:#fff;color:#111F35;text-align:center;box-shadow:0 2px 12px #0002;z-index:1000}
      #message[hidden]{display:none}</style></head><body>$body</body></html>
    """.trimIndent()
    loadDataWithBaseURL("https://nahtreek.local/", html, "text/html", "UTF-8", null)
  }
}

class GeoapifyMapViewManager : SimpleViewManager<GeoapifyMapWebView>() {
  override fun getName(): String = "GeoapifyMapView"
  override fun createViewInstance(context: ThemedReactContext): GeoapifyMapWebView = GeoapifyMapWebView(context)

  @ReactProp(name = "latitude")
  fun setLatitude(view: GeoapifyMapWebView, value: Double) {
    view.latitude = value
    view.showLocation()
  }

  @ReactProp(name = "longitude")
  fun setLongitude(view: GeoapifyMapWebView, value: Double) {
    view.longitude = value
    view.showLocation()
  }

  override fun onDropViewInstance(view: GeoapifyMapWebView) {
    view.stopLoading()
    view.destroy()
    super.onDropViewInstance(view)
  }
}
