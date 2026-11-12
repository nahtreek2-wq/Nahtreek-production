package com.nahtreek.client

import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import java.util.Locale
import java.util.concurrent.Executors
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import java.nio.charset.StandardCharsets
import android.net.Uri
import java.io.File
import java.util.UUID
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import java.security.SecureRandom
import java.security.MessageDigest
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricPrompt
import android.hardware.biometrics.BiometricManager

class NahtreekRuntimeConfigModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
  private val securePreferences =
      reactContext.getSharedPreferences("nahtreek_secure_session", Context.MODE_PRIVATE)
  private val keyAlias = "nahtreek_client_session_key"
  private val locationExecutor = Executors.newSingleThreadExecutor()
  private val credentialExecutor = Executors.newSingleThreadExecutor()

  @ReactMethod
  fun getStaticMapUrl(latitude: Double, longitude: Double, promise: Promise) {
    val key = BuildConfig.GEOAPIFY_API_KEY
    if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
      promise.reject("MAP_COORDINATES", "This location is not available yet."); return
    }
    if (key.isBlank()) { promise.reject("MAP_CONFIG", "Map is not configured in this build."); return }
    val url = Uri.parse("https://maps.geoapify.com/v1/staticmap").buildUpon()
        .appendQueryParameter("style", "carto")
        .appendQueryParameter("width", "600")
        .appendQueryParameter("height", "800")
        .appendQueryParameter("center", "lonlat:$longitude,$latitude")
        .appendQueryParameter("zoom", "15")
        .appendQueryParameter("apiKey", key)
        .build().toString()
    promise.resolve(url)
  }

  @ReactMethod
  fun getMapHtml(latitude: Double, longitude: Double, promise: Promise) {
    if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
      promise.reject("MAP_COORDINATES", "This location is not available yet."); return
    }
    val key = BuildConfig.GEOAPIFY_API_KEY
    if (key.isBlank()) { promise.reject("MAP_CONFIG", "Map is not configured in this build."); return }
    val staticMap = Uri.parse("https://maps.geoapify.com/v1/staticmap").buildUpon()
        .appendQueryParameter("style", "carto")
        .appendQueryParameter("width", "600")
        .appendQueryParameter("height", "800")
        .appendQueryParameter("center", "lonlat:$longitude,$latitude")
        .appendQueryParameter("zoom", "15")
        .appendQueryParameter("apiKey", key)
        .build().toString()
    promise.resolve(buildMapHtml(latitude, longitude, key, staticMap))
  }

  private fun assetText(name: String): String {
    // Leaflet ships inside the app (no CDN): the map stays interactive on any network.
    return try { reactApplicationContext.assets.open(name).bufferedReader().use { it.readText() } } catch (e: Exception) { "" }
  }

  private fun buildMapHtml(lat: Double, lon: Double, key: String, staticMap: String): String {
    val body = """
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
          tiles.on('tileerror', function() { showFallback(); });
          tiles.on('tileload', function() { document.getElementById('message').hidden = true; });
          tiles.addTo(map);
          L.circleMarker([lat, lon], {radius: 9, color: '#111F35', weight: 4, fillColor: '#C4A639', fillOpacity: 1}).addTo(map);
        }
      </script>
      """.trimIndent()
    return """
      <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      <style>html,body,#map,#fallback{width:100%;height:100%;margin:0}body{font-family:sans-serif;background:#f7f9fc}
      #fallback{display:none;position:relative}#static-map{width:100%;height:100%;object-fit:cover}
      #pin{position:absolute;top:50%;left:50%;width:22px;height:22px;border-radius:50%;background:#C4A639;
      border:4px solid #111F35;box-shadow:0 2px 8px #0005;transform:translate(-50%,-50%)}
      #message{position:absolute;bottom:26px;left:12px;right:12px;padding:12px;border-radius:10px;
      background:#fff;color:#111F35;text-align:center;box-shadow:0 2px 12px #0002;z-index:1000}
      #message[hidden]{display:none}</style></head><body>$body</body></html>
    """.trimIndent()
  }

  private fun localOnly() {
    check(BuildConfig.NAHTREEK_ENVIRONMENT == "staging" && BuildConfig.NAHTREEK_API_BASE_URL.isBlank()) { "Local accounts are available only in unconfigured internal builds" }
  }

  @ReactMethod
  fun getLocalAccounts(promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        val stored = securePreferences.getString("local_accounts", null)
        if (stored == null) { promise.resolve(null); return@execute }
        val combined = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
        promise.resolve(String(cipher.doFinal(combined.copyOfRange(12, combined.size)), StandardCharsets.UTF_8))
      } catch (error: Exception) { promise.reject("LOCAL_ACCOUNT_READ", "Could not unlock your local accounts") }
    }
  }

  @ReactMethod
  fun setLocalAccounts(payload: String, promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        check(payload.length <= 1000000)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
        check(securePreferences.edit().putString("local_accounts", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit())
        promise.resolve(null)
      } catch (error: Exception) { promise.reject("LOCAL_ACCOUNT_WRITE", "Could not save your local account") }
    }
  }

  private fun profileStorageKey(userId: String): String {
    check(userId.isNotBlank() && userId.length <= 200)
    return "profile:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(userId.toByteArray(StandardCharsets.UTF_8)), Base64.NO_WRAP)
  }

  @ReactMethod
  fun getLocalProfile(userId: String, promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        val stored = securePreferences.getString(profileStorageKey(userId), null)
        if (stored == null) { promise.resolve(null); return@execute }
        val combined = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
        promise.resolve(String(cipher.doFinal(combined.copyOfRange(12, combined.size)), StandardCharsets.UTF_8))
      } catch (error: Exception) { promise.reject("LOCAL_PROFILE_READ", "Could not unlock your local profile") }
    }
  }

  @ReactMethod
  fun setLocalProfile(userId: String, payload: String, promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        check(payload.length <= 10000)
        val storageKey = profileStorageKey(userId)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
        check(securePreferences.edit().putString(storageKey, Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit())
        promise.resolve(null)
      } catch (error: Exception) { promise.reject("LOCAL_PROFILE_WRITE", "Could not save your local profile") }
    }
  }

  private fun passwordKey(password: String, salt: ByteArray): ByteArray {
    check(password.length in 8..72 && password.toByteArray(StandardCharsets.UTF_8).size <= 72 && salt.size == 16)
    val spec = PBEKeySpec(password.toCharArray(), salt, 600000, 256)
    try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
    finally { spec.clearPassword() }
  }

  @ReactMethod
  fun hashLocalPassword(password: String, promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val result = Arguments.createMap()
        result.putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
        result.putString("hash", Base64.encodeToString(passwordKey(password, salt), Base64.NO_WRAP))
        promise.resolve(result)
      } catch (error: Exception) { promise.reject("LOCAL_PASSWORD", "Use a password with 8 to 72 characters (maximum 72 UTF-8 bytes)") }
    }
  }

  @ReactMethod
  fun verifyLocalPassword(password: String, salt: String, hash: String, promise: Promise) {
    credentialExecutor.execute {
      try {
        localOnly()
        promise.resolve(MessageDigest.isEqual(passwordKey(password, Base64.decode(salt, Base64.NO_WRAP)), Base64.decode(hash, Base64.NO_WRAP)))
      } catch (error: Exception) { promise.resolve(false) }
    }
  }

  @ReactMethod
  fun confirmLocalPasswordReset(promise: Promise) {
    try {
      localOnly()
      check(Build.VERSION.SDK_INT >= 30) { "Device-lock reset requires Android 11 or later" }
      val activity = currentActivity ?: throw IllegalStateException("Reopen the app and try again")
      val keyguard = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      check(keyguard.isDeviceSecure) { "Set a PIN, pattern or password in Android settings before resetting a local account" }
      activity.runOnUiThread {
        try {
          BiometricPrompt.Builder(activity).setTitle("Reset NAHTREEK password")
              .setDescription("Confirm your device lock to reset this local profile")
              .setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
              .build().authenticate(CancellationSignal(), activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { promise.resolve(true) }
                override fun onAuthenticationError(code: Int, message: CharSequence) { promise.reject("LOCAL_RESET_CANCELLED", "Device confirmation was cancelled or unavailable") }
              })
        } catch (error: Exception) { promise.reject("LOCAL_RESET", "Could not confirm your device lock") }
      }
    } catch (error: Exception) { promise.reject("LOCAL_RESET", error.message ?: "Device confirmation is unavailable") }
  }

  @ReactMethod
  fun persistProfilePhoto(uri: String, promise: Promise) {
    locationExecutor.execute {
      try {
        val parsed = Uri.parse(uri)
        check(parsed.scheme == "file" || parsed.scheme == "content") { "Choose a photo from this device" }
        val directory = File(reactApplicationContext.filesDir, "profile-photos")
        directory.mkdirs()
        val destination = File(directory, "${UUID.randomUUID()}.jpg")
        val stream = reactApplicationContext.contentResolver.openInputStream(parsed)
            ?: throw IllegalArgumentException("Photo is unavailable")
        stream.use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
        promise.resolve(Uri.fromFile(destination).toString())
      } catch (error: Exception) { promise.reject("PROFILE_PHOTO_SAVE", "Could not save your profile photo") }
    }
  }

  @ReactMethod
  fun searchLocations(query: String, promise: Promise) {
    if (query.trim().length < 3) { promise.reject("LOCATION_QUERY", "Enter at least three characters"); return }
    locationExecutor.execute {
      try {
        val key = BuildConfig.GEOAPIFY_API_KEY
        if (key.isNotBlank()) {
          val uri = Uri.parse("https://api.geoapify.com/v1/geocode/search").buildUpon()
              .appendQueryParameter("text", query.trim())
              .appendQueryParameter("filter", "countrycode:in")
              .appendQueryParameter("limit", "5")
              .appendQueryParameter("format", "json")
              .appendQueryParameter("apiKey", key)
              .build()
          try {
            val connection = URL(uri.toString()).openConnection() as HttpURLConnection
            connection.connectTimeout = 7000
            connection.readTimeout = 7000
            try {
              if (connection.responseCode == 200) {
                val payload = connection.inputStream.bufferedReader().use { it.readText() }
                val places = JSONObject(payload).optJSONArray("results")
                if (places != null && places.length() > 0) {
                  val results = Arguments.createArray()
                  for (index in 0 until places.length()) {
                    val place = places.optJSONObject(index) ?: continue
                    val lat = place.optDouble("lat", Double.NaN)
                    val lon = place.optDouble("lon", Double.NaN)
                    if (!lat.isFinite() || !lon.isFinite()) continue
                    val item = Arguments.createMap()
                    item.putString("address", place.optString("formatted", query.trim()))
                    item.putString("city", place.optString("city", place.optString("county", "")))
                    item.putString("state", place.optString("state", ""))
                    item.putDouble("latitude", lat)
                    item.putDouble("longitude", lon)
                    results.pushMap(item)
                  }
                  if (results.size() > 0) { promise.resolve(results); return@execute }
                }
              }
            } finally { connection.disconnect() }
          } catch (_: Exception) { /* Device geocoder remains the offline/system fallback. */ }
        }
        val addresses = Geocoder(reactApplicationContext, Locale.getDefault()).getFromLocationName(query, 5)
        val results = Arguments.createArray()
        addresses?.forEach { address ->
          val item = Arguments.createMap()
          item.putString("address", address.getAddressLine(0) ?: query)
          item.putString("city", address.locality ?: address.subAdminArea ?: "")
          item.putString("state", address.adminArea ?: "")
          item.putDouble("latitude", address.latitude)
          item.putDouble("longitude", address.longitude)
          results.pushMap(item)
        }
        promise.resolve(results)
      } catch (error: Exception) { promise.reject("LOCATION_SEARCH", "Location search is unavailable. Please try again.") }
    }
  }

  @ReactMethod
  fun currentLocation(promise: Promise) {
    val manager = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    try {
      val hasFine = Build.VERSION.SDK_INT < 23 || reactApplicationContext.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      val hasCoarse = Build.VERSION.SDK_INT < 23 || reactApplicationContext.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
      if (!hasFine && !hasCoarse) { promise.reject("LOCATION_PERMISSION", "Allow approximate or precise location, or search manually."); return }
      val provider = when {
        hasFine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        hasCoarse && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        hasFine && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> { promise.reject("LOCATION_DISABLED", "Turn on location or search manually."); return }
      }
      val signal = CancellationSignal()
      val handler = Handler(Looper.getMainLooper())
      val finished = java.util.concurrent.atomic.AtomicBoolean(false)
      var legacyListener: LocationListener? = null
      val timeout = Runnable {
        if (finished.compareAndSet(false, true)) {
          signal.cancel()
          legacyListener?.let { manager.removeUpdates(it) }
          promise.reject("LOCATION_TIMEOUT", "Could not get your location. Search manually or try again.")
        }
      }
      handler.postDelayed(timeout, 20000)
      val complete: (Location?) -> Unit = { location ->
        if (finished.compareAndSet(false, true)) {
          handler.removeCallbacks(timeout)
          if (location == null) promise.reject("LOCATION_EMPTY", "Could not get your location. Search manually.")
          else if (location.hasAccuracy() && location.accuracy > 200f)
            promise.reject("LOCATION_IMPRECISE", "Location is not accurate enough for a work address. Try again outdoors or search for your address.")
          else {
            locationExecutor.execute {
              val address = try {
                Geocoder(reactApplicationContext, Locale.getDefault())
                    .getFromLocation(location.latitude, location.longitude, 1)?.firstOrNull()
              } catch (error: Exception) { null }
              val result = Arguments.createMap()
              result.putDouble("latitude", location.latitude)
              result.putDouble("longitude", location.longitude)
              result.putString("address", address?.getAddressLine(0)
                  ?: "Pinned location (${location.latitude}, ${location.longitude})")
              result.putString("city", address?.locality ?: address?.subAdminArea ?: "")
              result.putString("state", address?.adminArea ?: "")
              promise.resolve(result)
            }
          }
        }
      }
      if (Build.VERSION.SDK_INT >= 30) {
        manager.getCurrentLocation(provider, signal, locationExecutor) { complete(it) }
      } else {
        val listener = object : LocationListener {
          override fun onLocationChanged(location: Location) { complete(location) }
          override fun onProviderDisabled(disabledProvider: String) { complete(null) }
        }
        legacyListener = listener
        manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
      }
    } catch (error: SecurityException) { promise.reject("LOCATION_PERMISSION", "Location permission is required. You can also search manually.") }
      catch (error: Exception) { promise.reject("LOCATION_UNAVAILABLE", "Please search for your address manually.") }
  }

  override fun getName(): String = "NahtreekRuntimeConfig"

  // Best-effort compromise signal (custom ROM/su binaries). The app only
  // shows a dismissible warning — it never blocks, so emulators, custom
  // ROMs and false positives cannot lock anyone out.
  private fun isDeviceCompromised(): Boolean {
    if (Build.TAGS?.contains("test-keys") == true) return true
    return arrayOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/sd/xbin/su",
        "/system/bin/failsafe/su", "/data/local/xbin/su", "/data/local/bin/su", "/data/local/su",
        "/su/bin/su", "/magisk/.core/bin/su").any { File(it).exists() }
  }

  override fun getConstants(): MutableMap<String, Any> =
      hashMapOf(
          "apiBaseUrl" to BuildConfig.NAHTREEK_API_BASE_URL,
          "environment" to BuildConfig.NAHTREEK_ENVIRONMENT,
          "deviceCompromised" to isDeviceCompromised(),
      )

  @ReactMethod
  fun getSecureSession(promise: Promise) {
    try {
      val stored = securePreferences.getString("payload", null)
      if (stored == null) {
        promise.resolve(null)
        return
      }
      val combined = Base64.decode(stored, Base64.NO_WRAP)
      val iv = combined.copyOfRange(0, 12)
      val encrypted = combined.copyOfRange(12, combined.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
      promise.resolve(String(cipher.doFinal(encrypted), StandardCharsets.UTF_8))
    } catch (error: Exception) {
      promise.reject("SECURE_SESSION_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun setSecureSession(payload: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
      val encrypted = cipher.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
      val combined = cipher.iv + encrypted
      val saved = securePreferences.edit()
          .putString("payload", Base64.encodeToString(combined, Base64.NO_WRAP))
          .commit()
      check(saved) { "Secure session could not be persisted" }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SECURE_SESSION_WRITE_FAILED", error)
    }
  }

  @ReactMethod
  fun clearSecureSession(promise: Promise) {
    // Logout removes only the session. Encrypted accounts and profiles must survive.
    if (securePreferences.edit().remove("payload").commit()) promise.resolve(null)
    else promise.reject("SECURE_SESSION_CLEAR_FAILED", "Saved sign-in could not be removed")
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!keyStore.containsAlias(keyAlias)) {
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(
          KeyGenParameterSpec.Builder(
                  keyAlias,
                  KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
              )
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build(),
      )
      generator.generateKey()
    }
    return keyStore.getKey(keyAlias, null) as SecretKey
  }
}

class NahtreekRuntimeConfigPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(NahtreekRuntimeConfigModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      listOf(GeoapifyMapViewManager())
}
