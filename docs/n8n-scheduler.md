# n8n Background Queue Processing Scheduler

This guide explains how to configure the recurring background scheduler in n8n to process queued resumes and job descriptions every 15 minutes.

---

## 1. Workflow Overview

The background processing pipeline runs on an automated cron schedule via n8n:

```
[ Schedule Trigger (Every 15 min) ]
               │
               ▼
[ HTTP Request Node: POST /api/internal/process-queue ]
               │
               ▼
[ Next.js API processes files one-by-one from E:/Srinivas/upload_resumes ]
```

---

## 2. Setting Up the 2-Node n8n Workflow

### Node 1: Schedule Trigger
* **Node Type**: `Schedule Trigger` (Cron)
* **Trigger Interval**: `Every 15 Minutes`
* **Cron Expression** (Optional): `*/15 * * * *`

### Node 2: HTTP Request
* **Node Type**: `HTTP Request`
* **Method**: `POST`
* **URL**:
  * Local: `http://localhost:3000/api/internal/process-queue`
  * Production: `https://your-domain.com/api/internal/process-queue`
* **Authentication**: None (handled via custom header)
* **Headers**:
  * Name: `x-secret`
  * Value: `{{ $env.CRON_SECRET || "abc123-change-this-to-long-random-text" }}`
  * Name: `Content-Type`
  * Value: `application/json`
* **Options**:
  * Timeout: `120000` (2 minutes)
  * Response Format: `JSON`

---

## 3. Workflow JSON (Import Ready)

You can copy and paste this JSON directly into your n8n workflow canvas:

```json
{
  "name": "Queue Upload Processing Scheduler",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "minutes",
              "minutesInterval": 15
            }
          ]
        }
      },
      "id": "schedule-trigger-1",
      "name": "Schedule Trigger (Every 15 Min)",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [250, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/internal/process-queue",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-secret",
              "value": "abc123-change-this-to-long-random-text"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "options": {
          "timeout": 120000
        }
      },
      "id": "http-request-1",
      "name": "Call Internal Queue Worker",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [500, 300]
    }
  ],
  "connections": {
    "Schedule Trigger (Every 15 Min)": {
      "main": [
        [
          {
            "node": "Call Internal Queue Worker",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

---

## 4. Behavior & Safeguards

1. **Atomic Locking (`FOR UPDATE SKIP LOCKED`)**:
   Prevents multiple concurrent workers from picking up the same file.
2. **Crash Recovery**:
   Any item stuck in `processing` for longer than 30 minutes is automatically reset to `pending`.
3. **Fault Tolerance**:
   If a single file is corrupted or fails, it is moved to `E:/Srinivas/upload_resumes/failed/` with an error logged in `upload_queue.error_message`. Remaining files continue processing uninterrupted.
4. **File Organization**:
   * Incoming files are stored in `E:/Srinivas/upload_resumes/incoming/candidates/` and `incoming/jobs/`.
   * Successfully processed files move to `E:/Srinivas/upload_resumes/processed/`.
   * Failed files move to `E:/Srinivas/upload_resumes/failed/`.

