import type { ProfileGender, VisibilityLevel } from './domain';

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  birth_date: string | null;
  gender: ProfileGender | null;
  gender_visibility: VisibilityLevel;
  age_visibility: VisibilityLevel;
  bio: string | null;
  city: string | null;
  email_verified: boolean;
  onboarding_completed: boolean;
  matching_enabled: boolean;
  account_disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventReadRow = {
  id: string;
  external_id: number | null;
  source_url: string;
  title: string;
  summary: string | null;
  description: string | null;
  start_at: string;
  end_at: string | null;
  venue: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  image_url: string | null;
  categories: string[];
  attendee_count: number;
  joined: boolean;
  saved: boolean;
  room_open: boolean;
  sort_cursor_at?: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      profile_photos: Table<{
        id: string;
        user_id: string;
        storage_path: string;
        position: number;
        created_at: string;
      }>;
      interests: Table<{
        id: string;
        slug: string;
        label: string;
        sort_order: number;
        is_active: boolean;
        created_at: string;
      }>;
      user_interests: Table<{
        user_id: string;
        interest_id: string;
        created_at: string;
      }>;
      cities: Table<{ plate_code: number; name: string; search_name: string }>;
      discovery_preferences: Table<{
        user_id: string;
        gender_preference: ProfileGender[];
        age_min: number;
        age_max: number;
        required_interest_ids: string[];
        created_at: string;
        updated_at: string;
      }>;
      entitlements: Table<{
        user_id: string;
        tier: 'free' | 'premium';
        active_until: string | null;
        created_at: string;
        updated_at: string;
      }>;
      events: Table<{
        id: string;
        external_id: number | null;
        source_guid: string;
        source_url: string;
        title: string;
        summary: string | null;
        description: string | null;
        start_at: string;
        end_at: string | null;
        venue: string | null;
        city: string | null;
        district: string | null;
        address: string | null;
        image_url: string | null;
        categories: string[];
        source_updated_at: string | null;
        is_cancelled: boolean;
        raw_source: Json;
        ingested_at: string;
        created_at: string;
        updated_at: string;
      }>;
      event_attendees: Table<{
        event_id: string;
        user_id: string;
        status: 'joined' | 'left';
        matching_enabled: boolean;
        joined_at: string;
        left_at: string | null;
        updated_at: string;
      }>;
      saved_events: Table<{
        user_id: string;
        event_id: string;
        created_at: string;
      }>;
      user_blocks: Table<{
        blocker_id: string;
        blocked_id: string;
        created_at: string;
      }>;
      matches: Table<{
        id: string;
        event_id: string;
        user1_id: string;
        user2_id: string;
        status: 'active' | 'ended' | 'blocked';
        first_like_by_user_id: string | null;
        accepted_by_user_id: string | null;
        compatibility_score: number;
        compatibility_snapshot: Json;
        matched_at: string;
        user1_chat_deleted_at: string | null;
        user2_chat_deleted_at: string | null;
        user1_chat_cleared_at: string | null;
        user2_chat_cleared_at: string | null;
        ended_at: string | null;
        ended_by_user_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      direct_messages: Table<{
        id: string;
        match_id: string;
        sender_id: string;
        receiver_id: string;
        body: string;
        client_message_id: string;
        read_at: string | null;
        created_at: string;
      }>;
      room_messages: Table<{
        id: string;
        event_id: string;
        sender_id: string;
        body: string;
        client_message_id: string;
        created_at: string;
      }>;
      chat_settings: Table<{
        match_id: string;
        owner_user_id: string;
        read_receipts_enabled: boolean;
        online_status_enabled: boolean;
        typing_indicator_enabled: boolean;
        notifications_enabled: boolean;
        created_at: string;
        updated_at: string;
      }>;
      chat_pair_summaries: Table<{
        match_id: string;
        last_message_id: string | null;
        last_message: string | null;
        last_message_at: string | null;
        unread_user1: number;
        unread_user2: number;
        updated_at: string;
      }>;
      room_read_states: Table<{
        event_id: string;
        user_id: string;
        last_read_at: string;
        updated_at: string;
      }>;
      notification_preferences: Table<{
        user_id: string;
        direct_messages_enabled: boolean;
        room_messages_enabled: boolean;
        likes_enabled: boolean;
        matches_enabled: boolean;
        event_reminders_enabled: boolean;
        system_enabled: boolean;
        created_at: string;
        updated_at: string;
      }>;
      push_tokens: Table<{
        id: string;
        user_id: string;
        expo_push_token: string;
        platform: 'android' | 'ios';
        project_id: string;
        app_version: string | null;
        last_seen_at: string;
        disabled_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      notification_events: Table<{
        id: string;
        user_id: string;
        actor_user_id: string | null;
        kind:
          | 'new_like'
          | 'new_match'
          | 'direct_message'
          | 'room_message'
          | 'match_ended'
          | 'blocked'
          | 'unblocked'
          | 'event_reminder'
          | 'system';
        route_kind: 'match' | 'room' | 'likes' | 'event' | null;
        route_id: string | null;
        title: string;
        body: string;
        payload: Json;
        channel_id: 'messages' | 'rooms' | 'matches' | 'events' | 'system';
        dedupe_key: string;
        delivery_status:
          | 'pending'
          | 'processing'
          | 'sent'
          | 'failed'
          | 'cancelled';
        attempt_count: number;
        next_attempt_at: string;
        last_error_code: string | null;
        delivered_at: string | null;
        read_at: string | null;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      get_registration_interests: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          id: string;
          slug: string;
          label: string;
          sort_order: number;
        }>;
      };
      is_username_available: {
        Args: { candidate_username: string };
        Returns: boolean;
      };
      is_email_available: {
        Args: { candidate_email: string };
        Returns: boolean;
      };
      get_event_card_states: {
        Args: { target_external_ids: number[] };
        Returns: Array<{
          database_id: string;
          external_id: number;
          attendee_count: number;
          joined: boolean;
          saved: boolean;
          attendee_photo_paths: string[];
        }>;
      };
      complete_onboarding: {
        Args: Record<PropertyKey, never>;
        Returns: ProfileRow;
      };
      join_event: {
        Args: { target_event_id: string };
        Returns: Database['public']['Tables']['event_attendees']['Row'];
      };
      leave_event: { Args: { target_event_id: string }; Returns: undefined };
      set_matching_enabled: {
        Args: { enabled: boolean; target_event_id?: string | null };
        Returns: undefined;
      };
      get_event_candidates: {
        Args: {
          target_event_id: string;
          page_size?: number;
          after_incoming?: boolean | null;
          after_joined_at?: string | null;
          after_user_id?: string | null;
        };
        Returns: Array<{
          id: string;
          full_name: string;
          username: string;
          age: number | null;
          gender: ProfileGender | null;
          bio: string;
          city: string;
          joined_at: string;
          incoming_like: boolean;
        }>;
      };
      get_candidate_compatibilities: {
        Args: { target_user_ids: string[] };
        Returns: Array<{
          target_user_id: string;
          compatibility: Json;
        }>;
      };
      get_match_context: {
        Args: {
          target_user_id?: string | null;
          target_match_id?: string | null;
        };
        Returns: Json | null;
      };
      get_chat_match_context: {
        Args: { target_match_id: string };
        Returns: Array<{
          match_id: string;
          event_id: string;
          event_title: string;
          other_user_id: string;
          other_full_name: string | null;
          other_username: string | null;
          other_age: number | null;
          other_gender: ProfileGender | null;
          other_bio: string | null;
          other_city: string | null;
          match_status: 'active' | 'ended' | 'blocked';
          match_created_at: string;
          last_message: string | null;
          last_message_at: string | null;
          blocked_by_me: boolean;
          photo_ids: string[];
          photo_storage_paths: string[];
          photo_positions: number[];
        }>;
      };
      swipe_event_candidate: {
        Args: {
          target_event_id: string;
          target_user_id: string;
          action: 'like' | 'pass';
          request_id: string;
        };
        Returns: Json;
      };
      swipe_event_candidate_v2: {
        Args: {
          target_event_id: string;
          target_user_id: string;
          action: 'like' | 'pass';
          request_id: string;
        };
        Returns: Json;
      };
      get_swipe_quota: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      get_matching_like_counts: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      get_outgoing_event_likes: {
        Args: {
          page_size?: number;
          after_liked_at?: string | null;
          after_user_id?: string | null;
        };
        Returns: Array<{
          id: string;
          full_name: string;
          username: string;
          age: number | null;
          gender: ProfileGender | null;
          bio: string;
          city: string;
          joined_at: string;
          event_id: string;
          event_title: string;
          liked_at: string;
          is_matched: boolean;
        }>;
      };
      get_incoming_event_likes: {
        Args: {
          page_size?: number;
          after_liked_at?: string | null;
          after_user_id?: string | null;
        };
        Returns: Array<{
          id: string;
          full_name: string;
          username: string;
          age: number | null;
          gender: ProfileGender | null;
          bio: string;
          city: string;
          joined_at: string;
          event_id: string;
          event_title: string;
          liked_at: string;
          is_matched: boolean;
        }>;
      };
      change_event_like_to_pass: {
        Args: {
          target_event_id: string;
          target_user_id: string;
          request_id: string;
        };
        Returns: Json;
      };
      get_my_profile: { Args: Record<string, never>; Returns: ProfileRow[] };
      get_profile_view: {
        Args: { target_profile_id: string };
        Returns: Array<{
          id: string;
          full_name: string | null;
          username: string | null;
          birth_date: string | null;
          age: number | null;
          gender: ProfileGender | null;
          gender_visibility: VisibilityLevel | null;
          age_visibility: VisibilityLevel | null;
          bio: string | null;
          city: string | null;
          email_verified: boolean;
          onboarding_completed: boolean;
          matching_enabled: boolean;
          created_at: string;
        }>;
      };
      send_direct_message: {
        Args: {
          target_match_id: string;
          message_body: string;
          client_message_id: string;
        };
        Returns: Database['public']['Tables']['direct_messages']['Row'];
      };
      send_room_message: {
        Args: {
          target_event_id: string;
          message_body: string;
          client_message_id: string;
        };
        Returns: Database['public']['Tables']['room_messages']['Row'];
      };
      list_room_messages: {
        Args: {
          target_event_id: string;
          page_size?: number;
          cursor_created_at?: string | null;
          cursor_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          event_id: string;
          sender_id: string;
          sender_name: string;
          sender_photo_path: string | null;
          body: string;
          client_message_id: string;
          created_at: string;
        }>;
      };
      mark_match_read: { Args: { target_match_id: string }; Returns: number };
      submit_room_report: {
        Args: {
          target_event_id: string;
          reason: string;
          details: string;
          client_request_id?: string;
        };
        Returns: string;
      };
      end_match: { Args: { target_match_id: string }; Returns: undefined };
      block_user: { Args: { target_user_id: string }; Returns: undefined };
      unblock_user: { Args: { target_user_id: string }; Returns: undefined };
      list_blocked_users: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          id: string;
          full_name: string | null;
          username: string | null;
          primary_photo_path: string | null;
          blocked_at: string;
        }>;
      };
      delete_match_chat: {
        Args: {
          target_match_id: string;
          delete_mode?: 'end' | 'block';
        };
        Returns: undefined;
      };
      is_event_room_open: {
        Args: { target_event_id: string };
        Returns: boolean;
      };
      search_events: {
        Args: {
          search_text?: string | null;
          city_filter?: string | null;
          category_filter?: string | null;
          starts_after?: string | null;
          starts_before?: string | null;
          sort_by?: 'upcoming' | 'newest';
          page_size?: number;
          cursor_sort_at?: string | null;
          cursor_event_id?: string | null;
        };
        Returns: EventReadRow[];
      };
      get_event_detail: {
        Args: { target_event_id: string };
        Returns: EventReadRow[];
      };
      list_saved_events: {
        Args: {
          page_size?: number;
          cursor_saved_at?: string | null;
          cursor_event_id?: string | null;
        };
        Returns: Array<EventReadRow & { saved_at: string }>;
      };
      list_joined_events: {
        Args: {
          include_left?: boolean;
          page_size?: number;
          cursor_joined_at?: string | null;
          cursor_event_id?: string | null;
        };
        Returns: Array<
          Omit<EventReadRow, 'description' | 'district' | 'address'> & {
            joined_at: string;
          }
        >;
      };
      list_profile_events: {
        Args: {
          profile_user_id: string;
          list_kind: string;
          page_size?: number;
          page_offset?: number;
        };
        Returns: Array<
          Pick<
            EventReadRow,
            | 'id'
            | 'title'
            | 'start_at'
            | 'venue'
            | 'city'
            | 'image_url'
            | 'categories'
          >
        >;
      };
      list_joined_rooms: {
        Args: {
          page_size?: number;
          cursor_joined_at?: string | null;
          cursor_event_id?: string | null;
        };
        Returns: Array<{
          event_id: string;
          title: string;
          start_at: string;
          end_at: string | null;
          image_url: string | null;
          city: string | null;
          venue: string | null;
          joined_at: string;
          matching_enabled: boolean;
          room_open: boolean;
          unread_count: number;
          last_message: string | null;
          last_message_is_mine: boolean;
          last_message_sender_name: string | null;
          last_message_at: string | null;
        }>;
      };
      mark_room_read: { Args: { target_event_id: string }; Returns: undefined };
      register_push_token: {
        Args: {
          expo_token: string;
          token_platform: 'android' | 'ios';
          project_id: string;
          app_version?: string | null;
        };
        Returns: undefined;
      };
      unregister_push_token: {
        Args: { expo_token: string };
        Returns: undefined;
      };
      list_matches: {
        Args: {
          status_filter?: string;
          page_size?: number;
          cursor_activity_at?: string | null;
          cursor_match_id?: string | null;
        };
        Returns: Array<{
          match_id: string;
          event_id: string;
          event_title: string;
          other_user_id: string;
          other_full_name: string;
          other_username: string;
          other_age: number | null;
          other_gender: ProfileGender | null;
          other_bio: string;
          other_city: string;
          other_primary_photo_path: string | null;
          match_status: 'active' | 'ended' | 'blocked';
          match_created_at: string;
          last_message: string | null;
          last_message_at: string | null;
          unread_count: number;
          activity_at: string;
        }>;
      };
      set_match_filters: {
        Args: {
          genders: ProfileGender[];
          minimum_age: number;
          maximum_age: number;
          interest_ids?: string[];
        };
        Returns: Database['public']['Tables']['discovery_preferences']['Row'];
      };
      submit_report: {
        Args: {
          target_user_id: string;
          reason:
            | 'fake_profile'
            | 'harassment'
            | 'spam'
            | 'nudity'
            | 'underage'
            | 'hate_speech'
            | 'other';
          details: string;
          target_event_id?: string | null;
          target_match_id?: string | null;
          client_context?: Json;
          block_after?: boolean;
          client_request_id?: string;
        };
        Returns: string;
      };
      replace_profile_photos: {
        Args: { storage_paths: string[] };
        Returns: string[];
      };
      replace_profile_interests: {
        Args: { interest_ids: string[] };
        Returns: undefined;
      };
    };
    Enums: {
      profile_gender: ProfileGender;
      visibility_level: VisibilityLevel;
      attendance_status: 'joined' | 'left';
      match_status: 'active' | 'ended' | 'blocked';
      swipe_action: 'like' | 'pass';
      report_reason: string;
      report_status: string;
      event_sort: 'upcoming' | 'newest';
    };
    CompositeTypes: Record<string, never>;
  };
};
