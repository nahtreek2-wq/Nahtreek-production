package com.nahtreek.professional

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.nahtreek.push.NahtreekPush

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "NahtreekProfessional"

  // react-native-screens: fragments must never be restored on activity
  // recreation (font size, dark mode, multi-window). A null bundle forces a
  // clean restart instead of crashing with "Screen fragments should never
  // be restored". The JS session rehydrates from secure storage.
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  // singleTop (never singleTask/singleInstance): notification taps while the app is
  // open arrive here, and the Razorpay checkout activity result returns to the
  // caller. singleTask mangles that result, which hangs the checkout promise
  // and freezes the payment screen with its buttons disabled.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    NahtreekPush.emitOpened(intent)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
