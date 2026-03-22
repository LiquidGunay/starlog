from fastapi.testclient import TestClient


def test_voice_native_regression_surface(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    queued_command = client.post(
        "/v1/agent/command/voice",
        headers=auth_headers,
        files={"file": ("assistant-command.wav", b"RIFF....WAVEfmt ", "audio/wav")},
        data={
            "title": "Voice command",
            "duration_ms": "2100",
            "execute": "true",
            "device_target": "web-pwa",
            "provider_hint": "whisper_local",
        },
    )
    assert queued_command.status_code == 201
    job_id = queued_command.json()["id"]

    claimed_command = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "voice-native-regression-worker"},
        headers=auth_headers,
    )
    assert claimed_command.status_code == 200

    completed_command = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "voice-native-regression-worker",
            "provider_used": "whisper_local",
            "output": {"transcript": "create task Voice loop task due tomorrow priority 2"},
        },
        headers=auth_headers,
    )
    assert completed_command.status_code == 200
    assistant_command = completed_command.json()["output"]["assistant_command"]
    assert assistant_command["status"] == "executed"
    assert assistant_command["matched_intent"] == "create_task"

    briefing = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-03-22", "provider": "template"},
        headers=auth_headers,
    )
    assert briefing.status_code == 201
    briefing_payload = briefing.json()
    assert briefing_payload["date"] == "2026-03-22"
    assert "Task focus:" in briefing_payload["text"]
    assert "Calendar blocks:" in briefing_payload["text"]
    assert "Review pressure:" in briefing_payload["text"]
    assert briefing_payload["sections"]

    fetched_briefing = client.get("/v1/briefings/2026-03-22", headers=auth_headers)
    assert fetched_briefing.status_code == 200
    assert fetched_briefing.json()["id"] == briefing_payload["id"]

    audio_job = client.post(
        f"/v1/briefings/{briefing_payload['id']}/audio/render",
        json={"provider_hint": "piper_local"},
        headers=auth_headers,
    )
    assert audio_job.status_code == 201
    audio_job_id = audio_job.json()["id"]

    claimed_audio = client.post(
        f"/v1/ai/jobs/{audio_job_id}/claim",
        json={"worker_id": "briefing-audio-worker"},
        headers=auth_headers,
    )
    assert claimed_audio.status_code == 200

    completed_audio = client.post(
        f"/v1/ai/jobs/{audio_job_id}/complete",
        json={
            "worker_id": "briefing-audio-worker",
            "provider_used": "piper_local",
            "output": {"audio_ref": "media://briefings/2026-03-22.mp3"},
        },
        headers=auth_headers,
    )
    assert completed_audio.status_code == 200

    tasks = client.get("/v1/tasks", headers=auth_headers)
    assert tasks.status_code == 200
    assert any(task["title"] == "Voice loop task" for task in tasks.json())

    refreshed_briefing = client.get("/v1/briefings/2026-03-22", headers=auth_headers)
    assert refreshed_briefing.status_code == 200
    assert refreshed_briefing.json()["audio_ref"] == "media://briefings/2026-03-22.mp3"
