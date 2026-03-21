package com.starlog.app.dev

import android.content.Intent

object StarlogIntentStore {
  @Volatile
  private var latestIntentUrl: String? = null

  fun update(intent: Intent?) {
    latestIntentUrl = intent?.dataString
  }

  fun currentIntentUrl(): String? = latestIntentUrl

  fun clear() {
    latestIntentUrl = null
  }
}
