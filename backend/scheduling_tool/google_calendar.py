from pydantic import BaseModel
from datetime import datetime, timedelta
from google.auth import default
from googleapiclient.discovery import build
import pytz
import os
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

class ScheduleRequest(BaseModel):
    name: str
    email: str
    datetime: str  # ISO format, e.g., "2025-07-25T15:00:00-05:00"

SCOPES = ["https://www.googleapis.com/auth/calendar"]

# Helper for local OAuth

# Remove local OAuth logic and always use default credentials

def schedule_support_event(req: ScheduleRequest):
    try:
        # Parse and prepare time data
        start_time = datetime.fromisoformat(req.datetime)
        end_time = start_time + timedelta(minutes=30)

        # Always use default credentials
        credentials, _ = default(scopes=["https://www.googleapis.com/auth/calendar"])
        service = build("calendar", "v3", credentials=credentials)

        # Use primary calendar (or your shared calendar's email if needed)
        calendar_id = "primary"

        event = {
            "summary": "Support Call with Aven Agent",
            "description": f"Scheduled via the AI assistant for {req.name}.",
            "start": {
                "dateTime": start_time.isoformat(),
                "timeZone": "America/Chicago",
            },
            "end": {
                "dateTime": end_time.isoformat(),
                "timeZone": "America/Chicago",
            },
            "attendees": [{"email": req.email}],
            "reminders": {"useDefault": True},
        }

        created_event = service.events().insert(
            calendarId=calendar_id,
            body=event,
            sendUpdates="all"
        ).execute()

        return {
            "message": "✅ Call scheduled!",
            "event_link": created_event.get("htmlLink")
        }

    except Exception as e:
        print(f"[ERROR] {e}")
        return {"error": "Failed to schedule call.", "details": str(e)}

def get_available_times():
    try:
        # Set timezone and time window
        tz = pytz.timezone("America/Chicago")
        now = datetime.now(tz)
        start_of_day = now.replace(hour=9, minute=0, second=0, microsecond=0)
        end_of_day = now.replace(hour=17, minute=0, second=0, microsecond=0)
        days = 7
        slot_minutes = 30
        available_slots = []

        # Always use default credentials
        credentials, _ = default(scopes=["https://www.googleapis.com/auth/calendar"])
        service = build("calendar", "v3", credentials=credentials)
        calendar_id = "primary"

        for day in range(days):
            day_start = (start_of_day + timedelta(days=day))
            day_end = (end_of_day + timedelta(days=day))
            # Get events for this day
            events_result = service.events().list(
                calendarId=calendar_id,
                timeMin=day_start.isoformat(),
                timeMax=day_end.isoformat(),
                singleEvents=True,
                orderBy="startTime"
            ).execute()
            events = events_result.get("items", [])
            # Build a list of busy slots
            busy = []
            for event in events:
                start = event["start"].get("dateTime")
                end = event["end"].get("dateTime")
                if start and end:
                    busy.append((datetime.fromisoformat(start), datetime.fromisoformat(end)))
            # Generate all possible slots for the day
            slot = day_start
            while slot + timedelta(minutes=slot_minutes) <= day_end:
                slot_end = slot + timedelta(minutes=slot_minutes)
                # Check if slot overlaps with any busy period
                overlap = any(
                    (slot < b_end and slot_end > b_start)
                    for b_start, b_end in busy
                )
                if not overlap and slot > now:
                    available_slots.append(slot.isoformat())
                slot += timedelta(minutes=slot_minutes)
        return {"available_times": available_slots}
    except Exception as e:
        print(f"[ERROR] {e}")
        return {"error": "Failed to fetch available times.", "details": str(e)} 