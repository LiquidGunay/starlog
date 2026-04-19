package com.starlog.app.dev

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

object StarlogAlarmScheduler {
  private const val PREFS_NAME = "starlog_alarm_prefs"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_HOUR = "hour"
  private const val KEY_MINUTE = "minute"
  private const val KEY_BRIEFING_PATH = "briefing_path"
  private const val KEY_FALLBACK_TEXT = "fallback_text"

  const val ACTION_TRIGGER_ALARM = "com.starlog.app.dev.action.TRIGGER_ALARM"
  const val EXTRA_HOUR = "hour"
  const val EXTRA_MINUTE = "minute"
  const val EXTRA_BRIEFING_PATH = "briefing_path"
  const val EXTRA_FALLBACK_TEXT = "fallback_text"
  const val EXTRA_IS_SNOOZE = "is_snooze"
  const val ALARM_ID = "daily_morning_alarm"

  private const val REQUEST_CODE_DAILY = 4101
  private const val REQUEST_CODE_SNOOZE = 4102

  fun isAvailable(context: Context): Boolean {
    return context.getSystemService(AlarmManager::class.java) != null
  }

  fun scheduleDailyAlarm(
    context: Context,
    hour: Int,
    minute: Int,
    briefingPath: String,
    fallbackText: String,
  ): ZonedDateTime {
    saveSchedule(context, hour, minute, briefingPath, fallbackText)
    val triggerAt = nextTriggerAt(hour, minute)
    scheduleIntent(
      context = context,
      triggerAt = triggerAt,
      requestCode = REQUEST_CODE_DAILY,
      hour = hour,
      minute = minute,
      briefingPath = briefingPath,
      fallbackText = fallbackText,
      isSnooze = false,
    )
    return triggerAt
  }

  fun cancelDailyAlarm(context: Context): Boolean {
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false
    alarmManager.cancel(buildPendingIntent(context, REQUEST_CODE_DAILY, null))
    alarmManager.cancel(buildPendingIntent(context, REQUEST_CODE_SNOOZE, null))
    clearSchedule(context)
    return true
  }

  fun scheduleSnooze(
    context: Context,
    minutes: Int,
    hour: Int,
    minute: Int,
    briefingPath: String,
    fallbackText: String,
  ): ZonedDateTime {
    val triggerAt = ZonedDateTime.ofInstant(
      Instant.ofEpochMilli(System.currentTimeMillis() + minutes * 60_000L),
      ZoneId.systemDefault(),
    )
    scheduleIntent(
      context = context,
      triggerAt = triggerAt,
      requestCode = REQUEST_CODE_SNOOZE,
      hour = hour,
      minute = minute,
      briefingPath = briefingPath,
      fallbackText = fallbackText,
      isSnooze = true,
    )
    return triggerAt
  }

  fun rescheduleNextDailyIfNeeded(context: Context, currentIntent: Intent?) {
    if (currentIntent?.getBooleanExtra(EXTRA_IS_SNOOZE, false) == true) {
      return
    }
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(KEY_ENABLED, false)) {
      return
    }
    val hour = prefs.getInt(KEY_HOUR, 7)
    val minute = prefs.getInt(KEY_MINUTE, 0)
    val briefingPath = prefs.getString(KEY_BRIEFING_PATH, null) ?: return
    val fallbackText = prefs.getString(KEY_FALLBACK_TEXT, "") ?: ""
    val triggerAt = nextTriggerAt(hour, minute)
    scheduleIntent(
      context = context,
      triggerAt = triggerAt,
      requestCode = REQUEST_CODE_DAILY,
      hour = hour,
      minute = minute,
      briefingPath = briefingPath,
      fallbackText = fallbackText,
      isSnooze = false,
    )
  }

  private fun saveSchedule(context: Context, hour: Int, minute: Int, briefingPath: String, fallbackText: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_ENABLED, true)
      .putInt(KEY_HOUR, hour)
      .putInt(KEY_MINUTE, minute)
      .putString(KEY_BRIEFING_PATH, briefingPath)
      .putString(KEY_FALLBACK_TEXT, fallbackText)
      .apply()
  }

  private fun clearSchedule(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
  }

  private fun scheduleIntent(
    context: Context,
    triggerAt: ZonedDateTime,
    requestCode: Int,
    hour: Int,
    minute: Int,
    briefingPath: String,
    fallbackText: String,
    isSnooze: Boolean,
  ) {
    val alarmManager = context.getSystemService(AlarmManager::class.java)
      ?: throw IllegalStateException("AlarmManager is unavailable.")
    val operation = buildPendingIntent(
      context = context,
      requestCode = requestCode,
      intent = Intent(context, StarlogAlarmActivity::class.java).apply {
        action = ACTION_TRIGGER_ALARM
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(EXTRA_HOUR, hour)
        putExtra(EXTRA_MINUTE, minute)
        putExtra(EXTRA_BRIEFING_PATH, briefingPath)
        putExtra(EXTRA_FALLBACK_TEXT, fallbackText)
        putExtra(EXTRA_IS_SNOOZE, isSnooze)
      },
    )
    val triggerAtMillis = triggerAt.toInstant().toEpochMilli()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      val showIntent = PendingIntent.getActivity(
        context,
        requestCode + 100,
        Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAtMillis, showIntent), operation)
      return
    }

    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, operation)
  }

  private fun buildPendingIntent(context: Context, requestCode: Int, intent: Intent?): PendingIntent {
    val baseIntent = intent ?: Intent(context, StarlogAlarmActivity::class.java).apply {
      action = ACTION_TRIGGER_ALARM
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      baseIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun nextTriggerAt(hour: Int, minute: Int): ZonedDateTime {
    val now = ZonedDateTime.now()
    var next = now
      .withHour(hour.coerceIn(0, 23))
      .withMinute(minute.coerceIn(0, 59))
      .withSecond(0)
      .withNano(0)
    if (!next.isAfter(now)) {
      next = next.plusDays(1)
    }
    return next
  }
}
