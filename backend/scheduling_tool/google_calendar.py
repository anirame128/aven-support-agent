from pydantic import BaseModel
from datetime import datetime, timedelta
from google.auth import default
from googleapiclient.discovery import build
import pytz
import os
import re
from google.oauth2.credentials import Credentials
from typing import Optional, List, Dict, Any

class ScheduleRequest(BaseModel):
    name: str
    email: str
    datetime: str  # ISO format, e.g., "2025-07-25T15:00:00-05:00"
    phone: Optional[str] = None
    notes: Optional[str] = None

SCOPES = ["https://www.googleapis.com/auth/calendar"]

def get_oauth_credentials():
    required_vars = ["GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
    
    creds = Credentials(
        None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=SCOPES,
    )
    return creds

def schedule_support_event(req: ScheduleRequest):
    try:
        # Parse and prepare time data
        start_time = datetime.fromisoformat(req.datetime)
        end_time = start_time + timedelta(minutes=30)

        # Use OAuth2 credentials from environment
        credentials = get_oauth_credentials()
        service = build("calendar", "v3", credentials=credentials)

        # Use primary calendar (or your shared calendar's email if needed)
        calendar_id = "primary"

        # Prepare details for description
        desc = f"Scheduled via the AI assistant.\nName: {req.name}\nEmail: {req.email}"
        if req.phone:
            desc += f"\nPhone: {req.phone}"
        if req.notes:
            desc += f"\nNotes: {req.notes}"

        event = {
            "summary": "Support Call with Aven Agent",
            "description": desc,
            "start": {
                "dateTime": start_time.isoformat(),
                "timeZone": "America/Chicago",
            },
            "end": {
                "dateTime": end_time.isoformat(),
                "timeZone": "America/Chicago",
            },
            "attendees": [{"email": req.email, "displayName": req.name}],
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

        # Use OAuth2 credentials from environment
        credentials = get_oauth_credentials()
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

# ------------------------------------------------------------------
#  Voice Scheduling Flow Functions
# ------------------------------------------------------------------

def start_scheduling_flow() -> Dict[str, Any]:
    """Start the voice scheduling flow by first asking if user wants to schedule"""
    return {
        "message": "Would you like me to help you schedule a call with Aven's support team?",
        "stage": "offering_schedule",
        "done": False,
        "schedule_state": {
            "active": True,
            "stage": "offering_schedule"
        }
    }

def continue_scheduling_flow(user_text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Continue the voice scheduling flow based on current stage"""
    try:
        stage = state.get("stage", "offering_schedule")
        print(f"🔄 Scheduling flow - stage: {stage}, user_text: '{user_text}', state: {state}")
        
        if stage == "offering_schedule":
            return _handle_schedule_offer(user_text, state)
        elif stage == "awaiting_time":
            return _handle_time_selection(user_text, state)
        elif stage == "awaiting_contact":
            return _handle_contact_info(user_text, state)
        elif stage == "confirming":
            return _handle_confirmation(user_text, state)
        else:
            return {
                "message": "I'm not sure where we are in the scheduling process. Let's start over.",
                "stage": "error",
                "done": True,
                "error": "Unknown stage"
            }
    except Exception as e:
        print(f"[ERROR] continue_scheduling_flow: {e}")
        return {
            "message": "Sorry, there was an error. Let's try again.",
            "stage": "error", 
            "done": True,
            "error": str(e)
        }

def _handle_schedule_offer(user_text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Handle the initial offer to schedule a call"""
    print(f"📋 Schedule offer - user_text: '{user_text}'")
    if _is_yes_response(user_text):
        # User wants to schedule, get available times
        try:
            times_result = get_available_times()
            if "error" in times_result:
                return {
                    "message": "I'd love to help you schedule a call, but our calendar system isn't available right now. Please contact Aven support directly at support@aven.com or visit aven.com/contact to schedule your call.",
                    "stage": "error",
                    "done": True,
                    "error": times_result["error"]
                }
            
            available_times = times_result.get("available_times", [])[:5]  # Show first 5 slots
            
            if not available_times:
                return {
                    "message": "I don't see any available times in the next week. Please contact Aven support directly at support@aven.com or visit aven.com/contact to schedule your call.",
                    "stage": "error", 
                    "done": True,
                    "error": "No available times"
                }
            
            # Format times for speech
            formatted_times = []
            for time_str in available_times:
                dt = datetime.fromisoformat(time_str)
                formatted = dt.strftime("%A, %B %d at %I:%M %p")
                formatted_times.append(formatted)
            
            bullets = "\n".join(f"- {t}" for t in formatted_times)
            msg = (
                "I can schedule a support call with Aven's team. Here are some available times:\n\n"
                f"{bullets}\n\n"
                "Please tell me which time works best for you."
            )
            
            state["stage"] = "awaiting_time"
            state["available_times"] = available_times
            
            return {
                "message": msg,
                "stage": "awaiting_time",
                "done": False,
                "schedule_state": state
            }
        except Exception as e:
            print(f"[ERROR] getting available times: {e}")
            return {
                "message": "Sorry, I'm having trouble accessing the calendar. Please contact Aven support directly at support@aven.com or visit aven.com/contact to schedule your call.",
                "stage": "error",
                "done": True,
                "error": str(e)
            }
    elif _is_no_response(user_text):
        return {
            "message": "No problem! If you change your mind, just let me know. Is there anything else I can help you with?",
            "stage": "cancelled",
            "done": True,
            "schedule_state": None
        }
    else:
        return {
            "message": "I didn't catch that. Would you like me to help you schedule a call with Aven's support team? Please say yes or no.",
            "stage": "offering_schedule",
            "done": False,
            "schedule_state": state
        }

def _handle_time_selection(user_text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Handle time selection stage of voice scheduling"""
    available_times = state.get("available_times", [])
    chosen_time = _match_time_from_speech(user_text, available_times)
    
    if not chosen_time:
        # Try to be more helpful with time parsing
        return {
            "message": "I didn't catch which time you prefer. Could you say it again? For example, 'Monday at 2 PM' or 'Tuesday, March 5th at 10 AM'.",
            "stage": "awaiting_time",
            "done": False,
            "schedule_state": state
        }
    
    # Store chosen time and move to contact info
    state["chosen_time"] = chosen_time
    state["stage"] = "awaiting_contact"
    
    # Format the chosen time nicely for confirmation
    dt = datetime.fromisoformat(chosen_time)
    formatted_time = dt.strftime("%A, %B %d at %I:%M %p")
    
    return {
        "message": f"Great! I have you down for {formatted_time}. Now I need your contact information. Please tell me your full name, email address, and phone number.",
        "stage": "awaiting_contact",
        "done": False,
        "schedule_state": state
    }

def _handle_contact_info(user_text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Handle contact information collection stage with improved partial info handling"""
    name, email, phone = _parse_contact_from_speech(user_text)
    
    # Store any info we found
    if name:
        state["name"] = name
    if email:
        state["email"] = email  
    if phone:
        state["phone"] = phone
    
    # Check what we have and what's missing
    current_name = state.get("name")
    current_email = state.get("email")
    current_phone = state.get("phone")
    
    missing = []
    if not current_name:
        missing.append("name")
    if not current_email:
        missing.append("email")
    if not current_phone:
        missing.append("phone number")
    
    if missing:
        # Provide more specific prompts based on what's missing
        if len(missing) == 3:
            # Nothing provided yet
            return {
                "message": "I need your contact information. Please tell me your full name, email address, and phone number.",
                "stage": "awaiting_contact",
                "done": False,
                "schedule_state": state
            }
        elif len(missing) == 2:
            # Some info provided
            provided = []
            if current_name:
                provided.append("name")
            if current_email:
                provided.append("email")
            if current_phone:
                provided.append("phone")
            
            provided_str = ", ".join(provided)
            missing_str = " and ".join(missing)
            return {
                "message": f"I have your {provided_str}. I still need your {missing_str}. Please provide the missing information.",
                "stage": "awaiting_contact",
                "done": False,
                "schedule_state": state
            }
        else:
            # Only one thing missing
            missing_str = missing[0]
            return {
                "message": f"I still need your {missing_str}. Please provide the missing information.",
                "stage": "awaiting_contact",
                "done": False,
                "schedule_state": state
            }
    
    # We have everything, move to confirmation
    state["stage"] = "confirming"
    
    dt = datetime.fromisoformat(state["chosen_time"])
    formatted_time = dt.strftime("%A, %B %d at %I:%M %p")
    
    return {
        "message": f"Perfect! Let me confirm your appointment:\n\nTime: {formatted_time}\nName: {state['name']}\nEmail: {state['email']}\nPhone: {state['phone']}\n\nShould I go ahead and schedule this call for you?",
        "stage": "confirming",
        "done": False,
        "schedule_state": state
    }

def _handle_confirmation(user_text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Handle final confirmation stage"""
    if _is_yes_response(user_text):
        # Book the appointment
        try:
            schedule_req = ScheduleRequest(
                name=state["name"],
                email=state["email"],
                datetime=state["chosen_time"],
                phone=state.get("phone", ""),
                notes="Scheduled via voice assistant"
            )
            
            result = schedule_support_event(schedule_req)
            
            if "error" in result:
                return {
                    "message": "Sorry, there was an error booking your appointment. That time slot may no longer be available. Please try selecting a different time.",
                    "stage": "awaiting_time",
                    "done": False,
                    "schedule_state": {
                        "active": True,
                        "stage": "awaiting_time",
                        "available_times": state.get("available_times", [])
                    }
                }
            
            return {
                "message": "Excellent! Your support call has been scheduled and you'll receive a confirmation email shortly. Is there anything else I can help you with?",
                "stage": "done",
                "done": True,
                "schedule_state": None
            }
            
        except Exception as e:
            print(f"[ERROR] booking appointment: {e}")
            return {
                "message": "Sorry, there was an error booking your appointment. Please try again or contact support directly.",
                "stage": "error",
                "done": True,
                "error": str(e)
            }
    
    elif _is_no_response(user_text):
        return {
            "message": "No problem! If you'd like to schedule a call later, just let me know. Is there anything else I can help you with?",
            "stage": "cancelled",
            "done": True,
            "schedule_state": None
        }
    
    else:
        return {
            "message": "I didn't catch that. Should I go ahead and schedule this call? Please say yes or no.",
            "stage": "confirming",
            "done": False,
            "schedule_state": state
        }

# ------------------------------------------------------------------
#  Helper Functions for Voice Parsing
# ------------------------------------------------------------------

def _match_time_from_speech(user_text: str, available_times: List[str]) -> Optional[str]:
    """Try to match spoken time to available slots with improved flexibility"""
    user_lower = user_text.lower()
    print(f"🔍 Time matching - user text: '{user_text}', available times: {available_times}")
    
    # For each available time, try to match against user speech
    for time_str in available_times:
        dt = datetime.fromisoformat(time_str)
        
        # Check various formats the user might say
        formats_to_check = [
            dt.strftime("%A").lower(),  # "monday"
            dt.strftime("%A, %B %d").lower(),  # "monday, march 5"
            dt.strftime("%B %d").lower(),  # "march 5"
            dt.strftime("%B %dth").lower(),  # "march 5th"
            dt.strftime("%B %dst").lower(),  # "march 1st"
            dt.strftime("%B %dnd").lower(),  # "march 2nd"
            dt.strftime("%B %drd").lower(),  # "march 3rd"
            dt.strftime("%I %p").lower().replace(" ", ""),  # "2pm"
            dt.strftime("%I:%M %p").lower().replace(" ", ""),  # "2:30pm"
            dt.strftime("%A at %I %p").lower(),  # "monday at 2 pm"
            dt.strftime("%A at %I:%M %p").lower(),  # "monday at 2:30 pm"
            dt.strftime("%A, %B %d at %I %p").lower(),  # "monday, march 5 at 2 pm"
            dt.strftime("%A, %B %d at %I:%M %p").lower(),  # "monday, march 5 at 2:30 pm"
            dt.strftime("%B %d at %I %p").lower(),  # "march 5 at 2 pm"
            dt.strftime("%B %d at %I:%M %p").lower(),  # "march 5 at 2:30 pm"
            dt.strftime("%I %p on %A").lower(),  # "2 pm on monday"
            dt.strftime("%I:%M %p on %A").lower(),  # "2:30 pm on monday"
            # Add support for "th" suffix in dates
            dt.strftime("%A, %B %dth at %I %p").lower(),  # "saturday, july 26th at 10 am"
            dt.strftime("%A, %B %dth at %I:%M %p").lower(),  # "saturday, july 26th at 10:30 am"
            dt.strftime("%B %dth at %I %p").lower(),  # "july 26th at 10 am"
            dt.strftime("%B %dth at %I:%M %p").lower(),  # "july 26th at 10:30 am"
        ]
        
        # Check if any format matches
        for fmt in formats_to_check:
            if fmt in user_lower:
                return time_str
        
        # Also check for partial matches (just day and time)
        day_time_formats = [
            f"{dt.strftime('%A').lower()} {dt.strftime('%I %p').lower().replace(' ', '')}",  # "monday 2pm"
            f"{dt.strftime('%A').lower()} {dt.strftime('%I:%M %p').lower().replace(' ', '')}",  # "monday 2:30pm"
            f"{dt.strftime('%A').lower()} at {dt.strftime('%I %p').lower()}",  # "monday at 2 pm"
            f"{dt.strftime('%A').lower()} at {dt.strftime('%I:%M %p').lower()}",  # "monday at 2:30 pm"
        ]
        
        for fmt in day_time_formats:
            if fmt in user_lower:
                return time_str
        
        # Check for just time patterns that might match
        time_only_patterns = [
            dt.strftime("%I %p").lower().replace(" ", ""),  # "2pm"
            dt.strftime("%I:%M %p").lower().replace(" ", ""),  # "2:30pm"
            dt.strftime("%I %p").lower(),  # "2 pm"
            dt.strftime("%I:%M %p").lower(),  # "2:30 pm"
        ]
        
        # If user just says a time, try to match it to any available time
        for time_pattern in time_only_patterns:
            if time_pattern in user_lower:
                # Check if this is the only time mentioned (not part of a longer phrase)
                # This is a simple heuristic - if the user just says "9 AM" or "9am"
                if len(user_lower.split()) <= 3:  # Short phrases like "9 AM" or "9 am please"
                    return time_str
    
    # If no exact match found, try fuzzy matching for day names
    day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    mentioned_days = [day for day in day_names if day in user_lower]
    
    if mentioned_days:
        # Find times that match the mentioned day
        for time_str in available_times:
            dt = datetime.fromisoformat(time_str)
            if dt.strftime("%A").lower() in mentioned_days:
                # Check if the time is also mentioned
                time_patterns = [
                    r'\b\d{1,2}\s*(?:am|pm)\b',
                    r'\b\d{1,2}:\d{2}\s*(?:am|pm)\b'
                ]
                for pattern in time_patterns:
                    if re.search(pattern, user_lower):
                        return time_str
    
    # If still no match, try to extract time and day separately
    for time_str in available_times:
        dt = datetime.fromisoformat(time_str)
        day_name = dt.strftime("%A").lower()
        time_str_formatted = dt.strftime("%I %p").lower()
        time_str_formatted_no_space = dt.strftime("%I %p").lower().replace(" ", "")
        
        # Check if both day and time are mentioned
        day_mentioned = day_name in user_lower
        time_mentioned = (time_str_formatted in user_lower or 
                         time_str_formatted_no_space in user_lower or
                         f"{dt.strftime('%I')} am" in user_lower or
                         f"{dt.strftime('%I')} pm" in user_lower)
        
        if day_mentioned and time_mentioned:
            return time_str
    
    print(f"❌ No time match found for: '{user_text}'")
    return None

def _parse_contact_from_speech(user_text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Parse name, email, and phone from speech text with improved robustness"""
    name = None
    email = None
    phone = None
    
    # Clean and normalize the text
    text = user_text.strip()
    text_lower = text.lower()
    
    # Look for email patterns (more comprehensive)
    email_patterns = [
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        r'\b[A-Za-z0-9._%+-]+\s+at\s+[A-Za-z0-9.-]+\s+dot\s+[A-Z|a-z]{2,}\b',  # "user at gmail dot com"
        r'\b[A-Za-z0-9._%+-]+\s+at\s+[A-Za-z0-9.-]+\s*\.\s*[A-Z|a-z]{2,}\b'   # "user at gmail . com"
    ]
    
    for pattern in email_patterns:
        email_match = re.search(pattern, text, re.IGNORECASE)
        if email_match:
            email = email_match.group(0)
            # Clean up "at" and "dot" patterns
            if " at " in email.lower():
                email = email.replace(" at ", "@").replace(" dot ", ".")
            break
    
    # Look for phone patterns (various formats)
    phone_patterns = [
        r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b',  # 123-456-7890, 123.456.7890, 123 456 7890
        r'\(\d{3}\)\s*\d{3}[-.\s]?\d{4}',      # (123) 456-7890
        r'\b\d{10}\b',                          # 1234567890
        r'\b\d{3}\s+\d{3}\s+\d{4}\b',          # 123 456 7890
        r'\b\d{3}-\d{3}-\d{4}\b'               # 123-456-7890
    ]
    
    for pattern in phone_patterns:
        phone_match = re.search(pattern, text)
        if phone_match:
            phone = phone_match.group(0)
            break
    
    # For name, use more comprehensive patterns
    name_patterns = [
        # "My name is John Smith"
        r'(?:my\s+name\s+is|i\'m|name\s+is|this\s+is|i\s+am)\s+([a-zA-Z\s]+?)(?:\s+and|\s+my|\s+email|\s+phone|\s*$)',
        # "John Smith" at the beginning
        r'^([a-zA-Z]+\s+[a-zA-Z]+)(?:\s+[a-zA-Z0-9._%+-]+@|\s+\d{3}|\s+\(|\s*$)',
        # "John Smith" after "my name is" variations
        r'(?:my\s+name\s+is|i\'m|name\s+is)\s+([a-zA-Z]+\s+[a-zA-Z]+)',
        # "John Smith" standalone (if no email/phone found)
        r'\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b'
    ]
    
    for pattern in name_patterns:
        name_match = re.search(pattern, text, re.IGNORECASE)
        if name_match:
            potential_name = name_match.group(1).strip()
            # Basic validation - should be at least 2 words and not contain email/phone patterns
            words = potential_name.split()
            if (len(words) >= 2 and 
                not re.search(r'@', potential_name) and 
                not re.search(r'\d', potential_name)):
                name = potential_name
                break
    
    # If we still don't have a name, try to extract from remaining text
    if not name:
        # Remove email and phone from text to find name
        clean_text = text
        if email:
            clean_text = clean_text.replace(email, "")
        if phone:
            clean_text = clean_text.replace(phone, "")
        
        # Look for name patterns in cleaned text
        name_candidates = re.findall(r'\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b', clean_text)
        if name_candidates:
            name = name_candidates[0]
    
    return name, email, phone

def _is_yes_response(text: str) -> bool:
    """Check if text indicates yes/agreement"""
    yes_words = ['yes', 'yep', 'yeah', 'sure', 'ok', 'okay', 'correct', 'right', 'that\'s right', 'go ahead', 'book it', 'schedule it']
    text_lower = text.lower().strip()
    is_yes = any(word in text_lower for word in yes_words)
    print(f"🔍 Yes detection - text: '{text}', is_yes: {is_yes}")
    return is_yes

def _is_no_response(text: str) -> bool:
    """Check if text indicates no/disagreement"""
    no_words = ['no', 'nope', 'nah', 'cancel', 'don\'t', 'not now', 'never mind', 'nevermind']
    text_lower = text.lower().strip()
    return any(word in text_lower for word in no_words) 