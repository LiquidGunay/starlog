package com.starlog.app.dev

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class StarlogAlarmActivity : ComponentActivity() {
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null
  private var finishedByAction = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    configureWindow()
    StarlogAlarmScheduler.rescheduleNextDailyIfNeeded(this, intent)
    setContentView(buildContentView())
    startAlert()
  }

  override fun onDestroy() {
    stopAlert()
    super.onDestroy()
  }

  override fun onBackPressed() {
    // Keep the alarm explicit: the user must dismiss or snooze.
  }

  private fun configureWindow() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
    )
  }

  private fun buildContentView(): LinearLayout {
    val hour = intent.getIntExtra(StarlogAlarmScheduler.EXTRA_HOUR, 7)
    val minute = intent.getIntExtra(StarlogAlarmScheduler.EXTRA_MINUTE, 0)

    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(56, 72, 56, 72)
      setBackgroundColor(0xFF0D1117.toInt())
    }

    val title = TextView(this).apply {
      text = "Starlog Morning Alarm"
      textSize = 28f
      gravity = Gravity.CENTER
      setTextColor(0xFFF4F7FB.toInt())
    }
    val timeLabel = TextView(this).apply {
      text = String.format("%02d:%02d", hour, minute)
      textSize = 54f
      gravity = Gravity.CENTER
      setTextColor(0xFFF1B6CD.toInt())
    }
    val detail = TextView(this).apply {
      text = "Dismiss to hear your briefing, or snooze for 10 minutes."
      textSize = 16f
      gravity = Gravity.CENTER
      setTextColor(0xFF99A6B8.toInt())
    }
    val dismissButton = Button(this).apply {
      text = "Dismiss + Briefing"
      setOnClickListener { dismissAndOpenBriefing() }
    }
    val snoozeButton = Button(this).apply {
      text = "Snooze 10 Minutes"
      setOnClickListener { snoozeAlarm() }
    }

    val buttonLayout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      val params = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply {
        topMargin = 24
      }
      addView(dismissButton, params)
      addView(snoozeButton, params)
    }

    container.addView(title)
    container.addView(timeLabel)
    container.addView(detail)
    container.addView(buttonLayout)
    return container
  }

  private fun startAlert() {
    val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    ringtone = RingtoneManager.getRingtone(this, alarmUri)?.apply {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      }
      play()
    }

    vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
      manager?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
    vibrator?.let { nextVibrator ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        nextVibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 500), 0))
      } else {
        @Suppress("DEPRECATION")
        nextVibrator.vibrate(longArrayOf(0, 800, 500), 0)
      }
    }
  }

  private fun stopAlert() {
    ringtone?.stop()
    ringtone = null
    vibrator?.cancel()
  }

  private fun dismissAndOpenBriefing() {
    if (finishedByAction) {
      return
    }
    finishedByAction = true
    stopAlert()

    val briefingPath = intent.getStringExtra(StarlogAlarmScheduler.EXTRA_BRIEFING_PATH).orEmpty()
    val fallbackText = intent.getStringExtra(StarlogAlarmScheduler.EXTRA_FALLBACK_TEXT).orEmpty()
    val deepLink = buildDismissDeepLink(briefingPath, fallbackText)
    StarlogIntentStore.update(Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)))
    startActivity(
      Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = Uri.parse(deepLink)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
    )
    finish()
  }

  private fun snoozeAlarm() {
    if (finishedByAction) {
      return
    }
    finishedByAction = true
    stopAlert()

    val hour = intent.getIntExtra(StarlogAlarmScheduler.EXTRA_HOUR, 7)
    val minute = intent.getIntExtra(StarlogAlarmScheduler.EXTRA_MINUTE, 0)
    val briefingPath = intent.getStringExtra(StarlogAlarmScheduler.EXTRA_BRIEFING_PATH).orEmpty()
    val fallbackText = intent.getStringExtra(StarlogAlarmScheduler.EXTRA_FALLBACK_TEXT).orEmpty()
    StarlogAlarmScheduler.scheduleSnooze(
      context = this,
      minutes = 10,
      hour = hour,
      minute = minute,
      briefingPath = briefingPath,
      fallbackText = fallbackText,
    )
    finish()
  }

  private fun buildDismissDeepLink(briefingPath: String, fallbackText: String): String {
    val encodedPath = URLEncoder.encode(briefingPath, StandardCharsets.UTF_8.toString())
    val encodedFallback = URLEncoder.encode(fallbackText, StandardCharsets.UTF_8.toString())
    return "starlog://surface?tab=planner&play_briefing=1&briefing_path=$encodedPath&fallback_text=$encodedFallback"
  }
}
