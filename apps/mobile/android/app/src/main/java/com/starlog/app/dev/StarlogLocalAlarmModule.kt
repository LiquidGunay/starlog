package com.starlog.app.dev

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class StarlogLocalAlarmModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "StarlogLocalAlarm"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(StarlogAlarmScheduler.isAvailable(reactApplicationContext))
  }

  @ReactMethod
  fun scheduleDailyAlarm(options: ReadableMap, promise: Promise) {
    try {
      val hour = if (options.hasKey("hour")) options.getInt("hour") else 7
      val minute = if (options.hasKey("minute")) options.getInt("minute") else 0
      val briefingPath =
        if (options.hasKey("briefingPath") && !options.isNull("briefingPath")) {
          options.getString("briefingPath")?.trim().orEmpty()
        } else {
          ""
        }
      val fallbackText =
        if (options.hasKey("fallbackText") && !options.isNull("fallbackText")) {
          options.getString("fallbackText")?.trim().orEmpty()
        } else {
          ""
        }

      if (briefingPath.isBlank()) {
        promise.reject("alarm_invalid", "A cached briefing path is required to schedule the local alarm.")
        return
      }
      if (!StarlogAlarmScheduler.isAvailable(reactApplicationContext)) {
        promise.reject("alarm_unavailable", "Exact Android alarms are unavailable on this device.")
        return
      }

      val triggerAt = StarlogAlarmScheduler.scheduleDailyAlarm(
        context = reactApplicationContext,
        hour = hour,
        minute = minute,
        briefingPath = briefingPath,
        fallbackText = fallbackText,
      )
      promise.resolve(
        Arguments.createMap().apply {
          putString("alarmId", StarlogAlarmScheduler.ALARM_ID)
          putString("scheduledFor", triggerAt.toOffsetDateTime().toString())
        },
      )
    } catch (error: SecurityException) {
      promise.reject("alarm_permission", "Android exact alarm permission is unavailable.", error)
    } catch (error: Throwable) {
      promise.reject("alarm_schedule_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancelDailyAlarm(promise: Promise) {
    try {
      promise.resolve(StarlogAlarmScheduler.cancelDailyAlarm(reactApplicationContext))
    } catch (error: Throwable) {
      promise.reject("alarm_cancel_failed", error.message, error)
    }
  }

  @ReactMethod
  fun startPreviewAlarm(options: ReadableMap?, promise: Promise) {
    try {
      val hour =
        if (options != null && options.hasKey("hour")) {
          options.getInt("hour")
        } else {
          7
        }
      val minute =
        if (options != null && options.hasKey("minute")) {
          options.getInt("minute")
        } else {
          0
        }
      val briefingPath =
        if (options != null && options.hasKey("briefingPath") && !options.isNull("briefingPath")) {
          options.getString("briefingPath")?.trim().orEmpty()
        } else {
          ""
        }
      val fallbackText =
        if (options != null && options.hasKey("fallbackText") && !options.isNull("fallbackText")) {
          options.getString("fallbackText")?.trim().orEmpty()
        } else {
          "Starlog preview alarm"
        }

      reactApplicationContext.startActivity(
        Intent(reactApplicationContext, StarlogAlarmActivity::class.java).apply {
          action = StarlogAlarmScheduler.ACTION_TRIGGER_ALARM
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
          putExtra(StarlogAlarmScheduler.EXTRA_HOUR, hour)
          putExtra(StarlogAlarmScheduler.EXTRA_MINUTE, minute)
          putExtra(StarlogAlarmScheduler.EXTRA_BRIEFING_PATH, briefingPath)
          putExtra(StarlogAlarmScheduler.EXTRA_FALLBACK_TEXT, fallbackText)
          putExtra(StarlogAlarmScheduler.EXTRA_IS_SNOOZE, true)
        },
      )
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("alarm_preview_failed", error.message, error)
    }
  }
}
