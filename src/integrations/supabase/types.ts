export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          deletion_audit_id: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          requested_at: string
          status: Database["public"]["Enums"]["deletion_request_status"]
          user_id: string | null
        }
        Insert: {
          deletion_audit_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_request_status"]
          user_id?: string | null
        }
        Update: {
          deletion_audit_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_request_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_deletion_audit_id_fkey"
            columns: ["deletion_audit_id"]
            isOneToOne: false
            referencedRelation: "user_audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_deletion_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          deleted_at: string | null
          deleted_by: string | null
          deleted_with_region: boolean
          id: string
          latitude: number | null
          located_at: string | null
          longitude: number | null
          name: string
          postcode: string | null
          region_id: string
        }
        Insert: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_region?: boolean
          id?: string
          latitude?: number | null
          located_at?: string | null
          longitude?: number | null
          name: string
          postcode?: string | null
          region_id: string
        }
        Update: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_region?: boolean
          id?: string
          latitude?: number | null
          located_at?: string | null
          longitude?: number | null
          name?: string
          postcode?: string | null
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_preferences: {
        Row: {
          photo_consent: boolean
          photo_consent_changed_at: string | null
          updated_at: string
          updates_email_consent: boolean
          updates_email_consent_changed_at: string | null
          user_id: string
        }
        Insert: {
          photo_consent?: boolean
          photo_consent_changed_at?: string | null
          updated_at?: string
          updates_email_consent?: boolean
          updates_email_consent_changed_at?: string | null
          user_id: string
        }
        Update: {
          photo_consent?: boolean
          photo_consent_changed_at?: string | null
          updated_at?: string
          updates_email_consent?: boolean
          updates_email_consent_changed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          dedupe_key: string | null
          event_id: string | null
          id: string
          last_error: string | null
          not_before: string | null
          notification_id: string | null
          payload: NonNullable<Json>
          priority: number
          registration_id: string | null
          sent_at: string | null
          status: string
          subscriber_id: string | null
          template: string
          to_email: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_id?: string | null
          id?: string
          last_error?: string | null
          not_before?: string | null
          notification_id?: string | null
          payload?: NonNullable<Json>
          priority?: number
          registration_id?: string | null
          sent_at?: string | null
          status?: string
          subscriber_id?: string | null
          template: string
          to_email?: string | null
          user_id: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_id?: string | null
          id?: string
          last_error?: string | null
          not_before?: string | null
          notification_id?: string | null
          payload?: NonNullable<Json>
          priority?: number
          registration_id?: string | null
          sent_at?: string | null
          status?: string
          subscriber_id?: string | null
          template?: string
          to_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_announcements: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          recipients: number
          region_id: string | null
          target: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          recipients?: number
          region_id?: string | null
          target: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          recipients?: number
          region_id?: string | null
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_announcements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_announcements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_announcements_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          branch_id: string | null
          created_at: string
          event_id: string
          id: string
          region_id: string
          scope: string
        }
        Insert: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          region_id: string
          scope: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          region_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_cleanup_audit: {
        Row: {
          events_purged: number
          files_purged: number
          finished_at: string | null
          id: string
          outcome: string
          requests_purged: number
          started_at: string
          users_purged: number
        }
        Insert: {
          events_purged?: number
          files_purged?: number
          finished_at?: string | null
          id?: string
          outcome?: string
          requests_purged?: number
          started_at?: string
          users_purged?: number
        }
        Update: {
          events_purged?: number
          files_purged?: number
          finished_at?: string | null
          id?: string
          outcome?: string
          requests_purged?: number
          started_at?: string
          users_purged?: number
        }
        Relationships: []
      }
      event_deletion_jobs: {
        Row: {
          created_at: string
          event_id: string
          operation: string
          requested_by: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          operation?: string
          requested_by?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          operation?: string
          requested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_deletion_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_deletion_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_guests: {
        Row: {
          confirmed_at: string | null
          created_at: string
          email: string
          event_id: string
          full_name: string
          keep_informed: boolean
          phone: string | null
          registration_id: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          email: string
          event_id: string
          full_name: string
          keep_informed?: boolean
          phone?: string | null
          registration_id: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          email?: string
          event_id?: string
          full_name?: string
          keep_informed?: boolean
          phone?: string | null
          registration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_guests_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_media: {
        Row: {
          created_at: string
          event_id: string
          has_variants: boolean
          height: number | null
          id: string
          in_gallery: boolean
          kind: string
          original_name: string | null
          position: number
          source_url: string | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          has_variants?: boolean
          height?: number | null
          id?: string
          in_gallery?: boolean
          kind: string
          original_name?: string | null
          position: number
          source_url?: string | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          has_variants?: boolean
          height?: number | null
          id?: string
          in_gallery?: boolean
          kind?: string
          original_name?: string | null
          position?: number
          source_url?: string | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_media_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          attendance_marked_at: string | null
          attendance_marked_by: string | null
          cancelled_at: string | null
          created_at: string
          event_id: string
          guest: boolean
          ics_offset: number
          id: string
          notice: string | null
          notice_seen_at: string | null
          places: number
          registered_at: string
          show_name: boolean
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          event_id: string
          guest?: boolean
          ics_offset?: number
          id?: string
          notice?: string | null
          notice_seen_at?: string | null
          places?: number
          registered_at?: string
          show_name?: boolean
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          event_id?: string
          guest?: boolean
          ics_offset?: number
          id?: string
          notice?: string | null
          notice_seen_at?: string | null
          places?: number
          registered_at?: string
          show_name?: boolean
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_attendance_marked_by_fkey"
            columns: ["attendance_marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_request_media: {
        Row: {
          created_at: string
          id: string
          kind: string
          original_name: string | null
          request_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          original_name?: string | null
          request_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          original_name?: string | null
          request_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_request_media_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "event_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_request_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_requests: {
        Row: {
          all_day: boolean
          alt_end: string | null
          alt_end_date: string | null
          alt_start: string | null
          alt_start_date: string | null
          branch_id: string | null
          category: string | null
          created_at: string
          decline_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          event_id: string | null
          expected_attendees: number | null
          id: string
          is_online: boolean
          last_edited_at: string | null
          last_edited_by: string | null
          location_text: string | null
          notes: string | null
          notice: string | null
          notice_seen_at: string | null
          online_url: string | null
          organizer_name: string | null
          proposed_end: string | null
          proposed_end_date: string | null
          proposed_start: string | null
          proposed_start_date: string | null
          purge_requested_at: string | null
          reason: string | null
          region_id: string
          request_type: string
          requester_id: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          scope: string
          source: string | null
          source_url: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          alt_end?: string | null
          alt_end_date?: string | null
          alt_start?: string | null
          alt_start_date?: string | null
          branch_id?: string | null
          category?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          event_id?: string | null
          expected_attendees?: number | null
          id?: string
          is_online?: boolean
          last_edited_at?: string | null
          last_edited_by?: string | null
          location_text?: string | null
          notes?: string | null
          notice?: string | null
          notice_seen_at?: string | null
          online_url?: string | null
          organizer_name?: string | null
          proposed_end?: string | null
          proposed_end_date?: string | null
          proposed_start?: string | null
          proposed_start_date?: string | null
          purge_requested_at?: string | null
          reason?: string | null
          region_id: string
          request_type?: string
          requester_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope: string
          source?: string | null
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          alt_end?: string | null
          alt_end_date?: string | null
          alt_start?: string | null
          alt_start_date?: string | null
          branch_id?: string | null
          category?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          event_id?: string | null
          expected_attendees?: number | null
          id?: string
          is_online?: boolean
          last_edited_at?: string | null
          last_edited_by?: string | null
          location_text?: string | null
          notes?: string | null
          notice?: string | null
          notice_seen_at?: string | null
          online_url?: string | null
          organizer_name?: string | null
          proposed_end?: string | null
          proposed_end_date?: string | null
          proposed_start?: string | null
          proposed_start_date?: string | null
          purge_requested_at?: string | null
          reason?: string | null
          region_id?: string
          request_type?: string
          requester_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope?: string
          source?: string | null
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_requests_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          all_day: boolean
          audience: string
          branch_id: string | null
          capacity: number | null
          category: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string
          dtstart_local: string
          duration_minutes: number | null
          generated_until: string | null
          id: string
          location: string
          location_type: string
          media_event_id: string | null
          online_url: string | null
          organizer: string
          region_id: string | null
          registration_enabled: boolean
          rule: string
          scope: string
          span_days: number
          status: string
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          audience?: string
          branch_id?: string | null
          capacity?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          dtstart_local: string
          duration_minutes?: number | null
          generated_until?: string | null
          id?: string
          location?: string
          location_type?: string
          media_event_id?: string | null
          online_url?: string | null
          organizer: string
          region_id?: string | null
          registration_enabled?: boolean
          rule: string
          scope: string
          span_days?: number
          status?: string
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          audience?: string
          branch_id?: string | null
          capacity?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          dtstart_local?: string
          duration_minutes?: number | null
          generated_until?: string | null
          id?: string
          location?: string
          location_type?: string
          media_event_id?: string | null
          online_url?: string | null
          organizer?: string
          region_id?: string | null
          registration_enabled?: boolean
          rule?: string
          scope?: string
          span_days?: number
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_series_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_media_event_id_fkey"
            columns: ["media_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_videos: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          position: number
          thumb_path: string | null
          title: string
          youtube_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          position?: number
          thumb_path?: string | null
          title?: string
          youtube_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          position?: number
          thumb_path?: string | null
          title?: string
          youtube_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_videos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_videos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          audience: string
          branch_id: string | null
          capacity: number | null
          category: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_with_series: boolean
          description: string
          end_at: string | null
          end_date: string | null
          ics_sequence: number
          id: string
          is_external: boolean
          latitude: number | null
          located_at: string | null
          location: string
          location_tba: boolean
          location_type: string
          longitude: number | null
          max_places: number
          online_url: string | null
          organizer: string
          past_record: boolean
          postcode: string | null
          recurrence_key: string | null
          region_id: string | null
          registration_enabled: boolean
          scope: string
          series_exception: boolean
          series_id: string | null
          series_template: boolean
          start_at: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          audience?: string
          branch_id?: string | null
          capacity?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_series?: boolean
          description?: string
          end_at?: string | null
          end_date?: string | null
          ics_sequence?: number
          id?: string
          is_external?: boolean
          latitude?: number | null
          located_at?: string | null
          location?: string
          location_tba?: boolean
          location_type?: string
          longitude?: number | null
          max_places?: number
          online_url?: string | null
          organizer: string
          past_record?: boolean
          postcode?: string | null
          recurrence_key?: string | null
          region_id?: string | null
          registration_enabled?: boolean
          scope: string
          series_exception?: boolean
          series_id?: string | null
          series_template?: boolean
          start_at?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          audience?: string
          branch_id?: string | null
          capacity?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_series?: boolean
          description?: string
          end_at?: string | null
          end_date?: string | null
          ics_sequence?: number
          id?: string
          is_external?: boolean
          latitude?: number | null
          located_at?: string | null
          location?: string
          location_tba?: boolean
          location_type?: string
          longitude?: number | null
          max_places?: number
          online_url?: string | null
          organizer?: string
          past_record?: boolean
          postcode?: string | null
          recurrence_key?: string | null
          region_id?: string | null
          registration_enabled?: boolean
          scope?: string
          series_exception?: boolean
          series_id?: string | null
          series_template?: boolean
          start_at?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_agenda_items: {
        Row: {
          carried_to: string | null
          created_at: string
          id: string
          meeting_id: string
          notes: string | null
          position: number
          resolved: boolean
          standing: boolean
          title: string
        }
        Insert: {
          carried_to?: string | null
          created_at?: string
          id?: string
          meeting_id: string
          notes?: string | null
          position: number
          resolved?: boolean
          standing?: boolean
          title: string
        }
        Update: {
          carried_to?: string | null
          created_at?: string
          id?: string
          meeting_id?: string
          notes?: string | null
          position?: number
          resolved?: boolean
          standing?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_agenda_items_carried_to_fkey"
            columns: ["carried_to"]
            isOneToOne: false
            referencedRelation: "meeting_agenda_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_agenda_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_decisions: {
        Row: {
          agenda_item_id: string
          created_at: string
          created_by: string | null
          id: string
          meeting_id: string
          text: string
        }
        Insert: {
          agenda_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id: string
          text: string
        }
        Update: {
          agenda_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_decisions_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "meeting_agenda_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_decisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_decisions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_files: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          meeting_id: string
          original_name: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          meeting_id: string
          original_name: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          meeting_id?: string
          original_name?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_files_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_invitees: {
        Row: {
          created_at: string
          invited_by: string | null
          meeting_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          meeting_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_invitees_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_invitees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_invitees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_requests: {
        Row: {
          branch_id: string | null
          created_at: string
          decline_reason: string | null
          id: string
          meeting_id: string | null
          note: string | null
          proposed_times: NonNullable<Json>
          region_id: string | null
          requester_id: string | null
          reviewed_at: string | null
          scope: string
          status: string
          target_id: string | null
          topic: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          meeting_id?: string | null
          note?: string | null
          proposed_times?: NonNullable<Json>
          region_id?: string | null
          requester_id?: string | null
          reviewed_at?: string | null
          scope: string
          status?: string
          target_id?: string | null
          topic: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          meeting_id?: string | null
          note?: string | null
          proposed_times?: NonNullable<Json>
          region_id?: string | null
          requester_id?: string | null
          reviewed_at?: string | null
          scope?: string
          status?: string
          target_id?: string | null
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_requests_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_requests_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_series: {
        Row: {
          agenda_template: NonNullable<Json>
          created_at: string
          created_by: string | null
          freq: string
          id: string
          interval_count: number
          occurrence_count: number
        }
        Insert: {
          agenda_template?: NonNullable<Json>
          created_at?: string
          created_by?: string | null
          freq: string
          id?: string
          interval_count?: number
          occurrence_count: number
        }
        Update: {
          agenda_template?: NonNullable<Json>
          created_at?: string
          created_by?: string | null
          freq?: string
          id?: string
          interval_count?: number
          occurrence_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          ends_at: string
          event_id: string
          id: string
          location: string | null
          location_type: string
          online_url: string | null
          purge_requested_at: string | null
          region_id: string | null
          scope: string
          series_id: string | null
          series_position: number | null
          source_request_id: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          ends_at: string
          event_id: string
          id?: string
          location?: string | null
          location_type?: string
          online_url?: string | null
          purge_requested_at?: string | null
          region_id?: string | null
          scope: string
          series_id?: string | null
          series_position?: number | null
          source_request_id?: string | null
          starts_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          ends_at?: string
          event_id?: string
          id?: string
          location?: string | null
          location_type?: string
          online_url?: string | null
          purge_requested_at?: string | null
          region_id?: string | null
          scope?: string
          series_id?: string | null
          series_position?: number | null
          source_request_id?: string | null
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "meeting_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_digest_log: {
        Row: {
          created_at: string
          day: string
          email_id: string | null
          notification_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          email_id?: string | null
          notification_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          email_id?: string | null
          notification_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_digest_log_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_digest_log_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_digest_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          task_reminder_emails: boolean
          types: NonNullable<Json>
          updated_at: string
          user_id: string
        }
        Insert: {
          task_reminder_emails?: boolean
          types?: NonNullable<Json>
          updated_at?: string
          user_id: string
        }
        Update: {
          task_reminder_emails?: boolean
          types?: NonNullable<Json>
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          digest_id: string | null
          email_digest: boolean
          email_digested_at: string | null
          entity_id: string
          entity_type: string
          held: boolean
          id: string
          kind: string
          link: string
          payload: NonNullable<Json>
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          digest_id?: string | null
          email_digest?: boolean
          email_digested_at?: string | null
          entity_id: string
          entity_type: string
          held?: boolean
          id?: string
          kind: string
          link: string
          payload?: NonNullable<Json>
          read_at?: string | null
          title?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          digest_id?: string | null
          email_digest?: boolean
          email_digested_at?: string | null
          entity_id?: string
          entity_type?: string
          held?: boolean
          id?: string
          kind?: string
          link?: string
          payload?: NonNullable<Json>
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_digest_id_fkey"
            columns: ["digest_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      postcode_geocodes: {
        Row: {
          fetched_at: string
          latitude: number
          longitude: number
          postcode: string
        }
        Insert: {
          fetched_at?: string
          latitude: number
          longitude: number
          postcode: string
        }
        Update: {
          fetched_at?: string
          latitude?: number
          longitude?: number
          postcode?: string
        }
        Relationships: []
      }
      privacy_notice_acceptances: {
        Row: {
          accepted_at: string
          id: string
          notice_version: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string
          id?: string
          notice_version: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string
          id?: string
          notice_version?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "privacy_notice_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          branch_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          full_name: string
          id: string
          phone: string | null
          preferred_language: string
          status: Database["public"]["Enums"]["profile_status"]
          welcome_seen_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          full_name?: string
          id: string
          phone?: string | null
          preferred_language?: string
          status?: Database["public"]["Enums"]["profile_status"]
          welcome_seen_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          preferred_language?: string
          status?: Database["public"]["Enums"]["profile_status"]
          welcome_seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          not_before: string | null
          notification_id: string
          sent_at: string | null
          status: string
          subscription_id: string
          type: string
          user_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          not_before?: string | null
          notification_id: string
          sent_at?: string | null
          status?: string
          subscription_id: string
          type: string
          user_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          not_before?: string | null
          notification_id?: string
          sent_at?: string | null
          status?: string
          subscription_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_outbox_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_rate_limits: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      recycle_bin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          branch_id: string | null
          created_at: string
          id: string
          item_id: string
          item_type: string
          region_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          region_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          region_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recycle_bin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
        }
        Insert: {
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
        }
        Update: {
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          branch_id: string | null
          confirm_sent_at: string | null
          confirmed_at: string | null
          consent_at: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          source: string
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          confirm_sent_at?: string | null
          confirmed_at?: string | null
          consent_at?: string
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          source: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          confirm_sent_at?: string | null
          confirmed_at?: string | null
          consent_at?: string
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          source?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          my_reminders: Json | null
          reminders_muted: boolean
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          my_reminders?: Json | null
          reminders_muted?: boolean
          task_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          my_reminders?: Json | null
          reminders_muted?: boolean
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_groups: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          decision_id: string | null
          description: string | null
          due_date: string | null
          event_id: string | null
          id: string
          meeting_id: string | null
          priority: string
          region_id: string
          scope: string
          title: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          decision_id?: string | null
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          id?: string
          meeting_id?: string | null
          priority?: string
          region_id: string
          scope?: string
          title: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          decision_id?: string | null
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          id?: string
          meeting_id?: string | null
          priority?: string
          region_id?: string
          scope?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_groups_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_groups_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "meeting_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_groups_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_groups_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          edited: boolean
          id: string
          mentions: string[]
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          edited?: boolean
          id?: string
          mentions?: string[]
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          edited?: boolean
          id?: string
          mentions?: string[]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminder_log: {
        Row: {
          created_at: string
          day: string
          kind: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          kind: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          kind?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminder_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminder_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_requests: {
        Row: {
          branch_id: string | null
          created_at: string
          decline_reason: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          region_id: string | null
          requester_id: string | null
          reviewed_at: string | null
          scope: string
          status: string
          target_id: string | null
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          region_id?: string | null
          requester_id?: string | null
          reviewed_at?: string | null
          scope: string
          status?: string
          target_id?: string | null
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          region_id?: string | null
          requester_id?: string | null
          reviewed_at?: string | null
          scope?: string
          status?: string
          target_id?: string | null
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_requests_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          decision_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          event_id: string | null
          group_id: string | null
          id: string
          meeting_id: string | null
          overdue_every_days: number | null
          priority: string
          region_id: string | null
          remind_before_days: number[]
          repeat_every_days: number | null
          repeat_kind: string
          repeat_start: string | null
          scope: string
          self_task: boolean
          source_request_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          decision_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          group_id?: string | null
          id?: string
          meeting_id?: string | null
          overdue_every_days?: number | null
          priority?: string
          region_id?: string | null
          remind_before_days?: number[]
          repeat_every_days?: number | null
          repeat_kind?: string
          repeat_start?: string | null
          scope: string
          self_task?: boolean
          source_request_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          decision_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          group_id?: string | null
          id?: string
          meeting_id?: string | null
          overdue_every_days?: number | null
          priority?: string
          region_id?: string | null
          remind_before_days?: number[]
          repeat_every_days?: number | null
          repeat_kind?: string
          repeat_start?: string | null
          scope?: string
          self_task?: boolean
          source_request_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "task_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "meeting_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["user_audit_action"]
          actor_id: string
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
          target_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["user_audit_action"]
          actor_id: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["user_audit_action"]
          actor_id?: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target_id?: string
        }
        Relationships: []
      }
      user_deletion_state: {
        Row: {
          created_at: string
          deletion_audit_id: string
          operation: string
          operation_actor: string | null
          previous_status: Database["public"]["Enums"]["profile_status"]
          self_requested: boolean
          target_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deletion_audit_id: string
          operation: string
          operation_actor?: string | null
          previous_status: Database["public"]["Enums"]["profile_status"]
          self_requested: boolean
          target_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deletion_audit_id?: string
          operation?: string
          operation_actor?: string | null
          previous_status?: Database["public"]["Enums"]["profile_status"]
          self_requested?: boolean
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_deletion_state_deletion_audit_id_fkey"
            columns: ["deletion_audit_id"]
            isOneToOne: false
            referencedRelation: "user_audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_deletion_state_operation_actor_fkey"
            columns: ["operation_actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_followed_branches: {
        Row: {
          branch_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_followed_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          region_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          region_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          region_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_applications: {
        Row: {
          availability: string | null
          branch_id: string
          commitment_accepted_at: string | null
          created_at: string
          decline_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          motivation: string
          phone: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          skills: string | null
          status: string
          time_commitment: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability?: string | null
          branch_id: string
          commitment_accepted_at?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          motivation: string
          phone?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          skills?: string | null
          status?: string
          time_commitment?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability?: string | null
          branch_id?: string
          commitment_accepted_at?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          motivation?: string
          phone?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          skills?: string | null
          status?: string
          time_commitment?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_applications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_applications_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_applications_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_privacy_notice: { Args: { p_version: string }; Returns: Json }
      accept_task_request: { Args: { p_id: string }; Returns: string }
      add_agenda_item: {
        Args: { p_meeting: string; p_notes?: string; p_title: string }
        Returns: string
      }
      add_agenda_items: {
        Args: { p_meeting: string; p_titles: Json }
        Returns: number
      }
      add_event_media: {
        Args: {
          _event: string
          _extension: string
          _kind: string
          _original_name: string
        }
        Returns: string
      }
      add_event_request_media: {
        Args: {
          p_extension: string
          p_kind: string
          p_original_name?: string
          p_request_id: string
        }
        Returns: Json
      }
      add_event_video: {
        Args: { p_event: string; p_title: string; p_youtube_id: string }
        Returns: string
      }
      add_media_photo: {
        Args: { p_branch: string; p_extension: string; p_hash: string; p_original_name: string; p_target: Json }
        Returns: Json
      }
      add_media_upload_file: {
        Args: { p_extension: string; p_hash: string; p_original_name: string; p_request: string }
        Returns: Json
      }
      add_meeting_decision: {
        Args: { p_item: string; p_text: string }
        Returns: string
      }
      add_meeting_file: {
        Args: {
          p_extension: string
          p_meeting: string
          p_original_name: string
        }
        Returns: Json
      }
      add_task_note: {
        Args: { p_body: string; p_mentions?: Json; p_task: string }
        Returns: string
      }
      agenda_titles: { Args: { p: Json }; Returns: string[] }
      announce_event: {
        Args: {
          p_branch?: string
          p_dry_run?: boolean
          p_event: string
          p_region?: string
          p_target: string
        }
        Returns: number
      }
      approve_event_request: {
        Args: { p_audience?: string; p_id: string }
        Returns: Json
      }
      approve_media_download_request: {
        Args: { p_id: string }
        Returns: undefined
      }
      approve_media_upload_request: {
        Args: { p_album_title?: string; p_file_ids: string[]; p_id: string }
        Returns: Json
      }
      approve_meeting_request: {
        Args: { p_id: string; p_meeting: Json }
        Returns: string
      }
      approve_volunteer_application: {
        Args: {
          p_id: string
          p_role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      archive_done_tasks: { Args: { p_ids: Json }; Returns: number }
      archive_task: {
        Args: { p_archived: boolean; p_id: string }
        Returns: boolean
      }
      authorize_follower_self_deletion: {
        Args: { _target: string }
        Returns: string
      }
      authorize_user_deletion: {
        Args: { _actor: string; _request?: string; _target: string }
        Returns: string
      }
      branch_delete_check: { Args: { _branch: string }; Returns: undefined }
      can_create_meeting: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
      can_create_task: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
      can_edit_meeting: { Args: { _meeting: string }; Returns: boolean }
      can_edit_task: { Args: { _task: string }; Returns: boolean }
      can_edit_task_group: {
        Args: { _group: string }
        Returns: boolean
      }
      can_manage_deleted_user: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_manage_event: { Args: { _event: string }; Returns: boolean }
      can_manage_event_scope: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
      can_manage_media: {
        Args: { _branch: string }
        Returns: boolean
      }
      can_manage_recycle_scope: {
        Args: { _actor: string; _branch: string; _region: string }
        Returns: boolean
      }
      can_manage_user: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_read_event_file: { Args: { _path: string }; Returns: boolean }
      can_read_event_request_file: { Args: { _path: string }; Returns: boolean }
      can_read_meeting_file: { Args: { _path: string }; Returns: boolean }
      can_restore_event: { Args: { _event: string }; Returns: boolean }
      can_request_media_upload: {
        Args: { _branch: string }
        Returns: boolean
      }
      can_review_event_request: {
        Args: { _r: Database["public"]["Tables"]["event_requests"]["Row"] }
        Returns: boolean
      }
      can_review_volunteer_application: {
        Args: { _branch: string }
        Returns: boolean
      }
      can_set_task_status: { Args: { _task: string }; Returns: boolean }
      can_view_event: { Args: { _event: string }; Returns: boolean }
      can_view_event_media: { Args: { _event: string }; Returns: boolean }
      can_view_meeting: { Args: { _meeting: string }; Returns: boolean }
      can_view_series: { Args: { _series: string }; Returns: boolean }
      can_view_task: { Args: { _task: string }; Returns: boolean }
      can_view_media: {
        Args: { _branch: string }
        Returns: boolean
      }
      can_view_task_group: {
        Args: { _group: string }
        Returns: boolean
      }
      can_write_event_file: { Args: { _path: string }; Returns: boolean }
      can_write_event_request_file: {
        Args: { _path: string }
        Returns: boolean
      }
      can_write_meeting_file: { Args: { _path: string }; Returns: boolean }
      cancel_account_deletion: { Args: never; Returns: undefined }
      cancel_event: { Args: { _event: string }; Returns: undefined }
      cancel_registration: { Args: { p_event_id: string }; Returns: Json }
      capture_email: {
        Args: { p_id: string; p_rendered: Json }
        Returns: undefined
      }
      carry_over_agenda: {
        Args: { p: Json; p_meeting: string }
        Returns: number
      }
      check_volunteer_answers: {
        Args: { _commitment: boolean; _help: string; _time: string }
        Returns: undefined
      }
      claim_push_batch: {
        Args: { p_max?: number }
        Returns: {
          attempts: number
          auth: string
          endpoint: string
          id: string
          kind: string
          language: string
          link: string
          notification_id: string
          p256dh: string
          payload: Json
        }[]
      }
      claim_email_batch: {
        Args: { p_max?: number; p_max_priority?: number }
        Returns: {
          attempts: number
          event_id: string
          id: string
          notification_id: string
          payload: Json
          priority: number
          registration_id: string
          skip_reason: string
          subscriber_id: string
          template: string
          to_email: string
          to_name: string
          user_id: string
        }[]
      }
      clean_reminders: { Args: { p: Json }; Returns: Json }
      clean_structure_name: { Args: { _name: string }; Returns: string }
      clear_deleted_media: {
        Args: never
        Returns: Json
      }
      create_branch: {
        Args: { p_name: string; p_region_id: string }
        Returns: string
      }
      create_event: { Args: { _data: Json }; Returns: string }
      create_meeting: { Args: { p: Json }; Returns: string }
      create_media_album: {
        Args: { p: Json; p_branch: string }
        Returns: string
      }
      create_media_upload_request: {
        Args: { p: Json }
        Returns: string
      }
      create_past_event: {
        Args: {
          p_branch: string
          p_date: string
          p_description: string
          p_title: string
        }
        Returns: string
      }
      create_region: { Args: { p_name: string }; Returns: string }
      create_series: { Args: { _data: Json; _rule: string }; Returns: Json }
      create_task: { Args: { p: Json }; Returns: string }
      create_task_group: {
        Args: { p: Json }
        Returns: string
      }
      decline_event_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      decline_media_download_request: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      decline_media_upload_request: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      decline_meeting_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      decline_task_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      decline_volunteer_application: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_agenda_item: { Args: { p_id: string }; Returns: undefined }
      delete_branch: { Args: { p_id: string }; Returns: undefined }
      delete_event: {
        Args: { _complete?: boolean; _event: string; _title?: string }
        Returns: Json
      }
      delete_event_media: { Args: { _media: string }; Returns: undefined }
      delete_event_request: { Args: { p_id: string }; Returns: undefined }
      delete_event_request_media: {
        Args: { p_media_id: string }
        Returns: undefined
      }
      delete_event_video: { Args: { p_id: string }; Returns: undefined }
      delete_meeting: { Args: { p_id: string }; Returns: undefined }
      delete_meeting_decision: { Args: { p_id: string }; Returns: undefined }
      delete_meeting_file: { Args: { p_id: string }; Returns: undefined }
      delete_media_album: {
        Args: { p_id: string; p_title: string }
        Returns: Json
      }
      delete_media_photos: {
        Args: { p_ids: string[] }
        Returns: Json
      }
      delete_meeting_series: {
        Args: { p_id: string; p_mode: string }
        Returns: number
      }
      delete_region: { Args: { p_id: string }; Returns: undefined }
      delete_series: { Args: { _event: string; _mode: string }; Returns: Json }
      delete_task: { Args: { p_id: string }; Returns: undefined }
      delete_task_group: {
        Args: { p_id: string }
        Returns: number
      }
      delete_task_note: { Args: { p_id: string }; Returns: undefined }
      delete_volunteer_application: {
        Args: { p_id: string }
        Returns: undefined
      }
      dismiss_event_request_notice: {
        Args: { p_id: string }
        Returns: undefined
      }
      dismiss_registration_notice: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      email_daily_limit: { Args: Record<PropertyKey, never>; Returns: number }
      email_event_context: { Args: { p_registration: string }; Returns: Json }
      email_priority: { Args: { _template: string }; Returns: number }
      enqueue_email: {
        Args: {
          _dedupe?: string
          _event: string
          _payload?: Json
          _registration: string
          _subscriber: string
          _template: string
        }
        Returns: string
      }
      enqueue_event_reminders: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      event_ends: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      event_has_registrations: { Args: { _event: string }; Returns: boolean }
      event_is_upcoming: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      event_map_point: {
        Args: {
          _e: Database["public"]["Tables"]["events"]["Row"]
        }
        Returns: Json
      }
      event_media_has_variants: { Args: { _path: string }; Returns: boolean }
      event_media_variant_paths: { Args: { _path: string }; Returns: string[] }
      event_request_actor: { Args: never; Returns: string }
      event_request_apply: {
        Args: {
          _id: string
          r: Database["public"]["Tables"]["event_requests"]["Row"]
        }
        Returns: undefined
      }
      event_request_countable: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
      event_request_fields: {
        Args: { _type: string; p: Json }
        Returns: {
          all_day: boolean
          alt_end: string | null
          alt_end_date: string | null
          alt_start: string | null
          alt_start_date: string | null
          branch_id: string | null
          category: string | null
          created_at: string
          decline_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          event_id: string | null
          expected_attendees: number | null
          id: string
          is_online: boolean
          last_edited_at: string | null
          last_edited_by: string | null
          location_text: string | null
          notes: string | null
          notice: string | null
          notice_seen_at: string | null
          online_url: string | null
          organizer_name: string | null
          proposed_end: string | null
          proposed_end_date: string | null
          proposed_start: string | null
          proposed_start_date: string | null
          purge_requested_at: string | null
          reason: string | null
          region_id: string
          request_type: string
          requester_id: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          scope: string
          source: string | null
          source_url: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "event_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      event_request_json: {
        Args: { _r: Database["public"]["Tables"]["event_requests"]["Row"] }
        Returns: Json
      }
      event_request_locked: {
        Args: { _id: string }
        Returns: {
          all_day: boolean
          alt_end: string | null
          alt_end_date: string | null
          alt_start: string | null
          alt_start_date: string | null
          branch_id: string | null
          category: string | null
          created_at: string
          decline_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          event_id: string | null
          expected_attendees: number | null
          id: string
          is_online: boolean
          last_edited_at: string | null
          last_edited_by: string | null
          location_text: string | null
          notes: string | null
          notice: string | null
          notice_seen_at: string | null
          online_url: string | null
          organizer_name: string | null
          proposed_end: string | null
          proposed_end_date: string | null
          proposed_start: string | null
          proposed_start_date: string | null
          purge_requested_at: string | null
          reason: string | null
          region_id: string
          request_type: string
          requester_id: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          scope: string
          source: string | null
          source_url: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "event_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      event_request_review_check: {
        Args: { _r: Database["public"]["Tables"]["event_requests"]["Row"] }
        Returns: undefined
      }
      event_sends_emails: {
        Args: {
          _e: Database["public"]["Tables"]["events"]["Row"]
        }
        Returns: boolean
      }
      event_starts: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      extend_all_series: { Args: never; Returns: number }
      finish_media_photo: {
        Args: { p_height: number; p_id: string; p_width: number }
        Returns: undefined
      }
      finish_media_upload_file: {
        Args: { p_height: number; p_id: string; p_width: number }
        Returns: undefined
      }
      finish_push: {
        Args: { p_error?: string; p_id: string; p_result: string }
        Returns: undefined
      }
      finish_email: {
        Args: { p_error?: string; p_id: string; p_result: string }
        Returns: undefined
      }
      finish_series_deletion: { Args: { _series: string }; Returns: Json }
      finish_series_purge: { Args: { _series: string }; Returns: undefined }
      finish_user_recycle_operation: {
        Args: { _id: string; _operation: string }
        Returns: undefined
      }
      follow_branch: { Args: { p_branch_id: string }; Returns: undefined }
      get_branch_map: { Args: Record<PropertyKey, never>; Returns: Json }
      get_event_announcements: {
        Args: { p_event: string }
        Returns: {
          branch: string
          created_at: string
          id: string
          recipients: number
          region: string
          target: string
        }[]
      }
      get_event_attendees: {
        Args: { p_event_id: string }
        Returns: {
          cancelled_at: string
          checked_in_at: string
          checked_in_by_name: string
          email: string
          full_name: string
          kind: string
          phone: string
          places: number
          registered_at: string
          registration_id: string
          status: string
          user_id: string
          waitlist_position: number
        }[]
      }
      get_event_deletion_state: { Args: { _event: string }; Returns: Json }
      get_event_registration_summary: {
        Args: { p_event_id: string }
        Returns: Json
      }
      get_event_registrations: {
        Args: { p_event_id: string }
        Returns: {
          attendance_marked_at: string
          attendance_marked_by_name: string
          cancelled_at: string
          email: string
          full_name: string
          id: string
          registered_at: string
          show_name: boolean
          status: string
          user_id: string
          waitlist_position: number
        }[]
      }
      get_event_request: { Args: { p_id: string }; Returns: Json }
      get_event_request_duplicates: { Args: { p_id: string }; Returns: Json }
      get_event_tasks: { Args: { p_event: string }; Returns: Json }
      get_event_video_for_removal: { Args: { p_id: string }; Returns: string }
      get_followed_branches: { Args: never; Returns: Json }
      get_meeting: { Args: { p_id: string }; Returns: Json }
      get_meeting_series_tasks: { Args: { p_id: string }; Returns: Json }
      get_media_chapter: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      get_media_chapters: {
        Args: { p_before_at?: string; p_before_id?: string; p_branch: string; p_limit?: number; p_search?: string; p_source?: string; p_year?: number }
        Returns: Json
      }
      get_media_download: {
        Args: { p_id: string }
        Returns: Json
      }
      get_media_highlights: {
        Args: { p_branch: string; p_limit?: number }
        Returns: Json
      }
      get_media_home: {
        Args: { p_branch?: string }
        Returns: Json
      }
      get_media_photos: {
        Args: { p_before_at?: string; p_before_id?: string; p_branch: string; p_limit?: number; p_source?: string; p_year?: number }
        Returns: Json
      }
      get_media_upload_request: {
        Args: { p_id: string }
        Returns: Json
      }
      get_my_registrations: {
        Args: never
        Returns: {
          all_day: boolean
          end_at: string
          end_date: string
          event_id: string
          event_removed: boolean
          event_status: string
          notice: string
          registration_id: string
          start_at: string
          start_date: string
          status: string
          title: string
          waitlist_position: number
        }[]
      }
      get_my_task_summary: { Args: never; Returns: Json }
      get_nc_dashboard: { Args: never; Returns: Json }
      get_notification_preferences: {
        Args: never
        Returns: Json
      }
      get_notification_settings: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_pending_event_request_count: { Args: never; Returns: Json }
      get_privacy_status: { Args: never; Returns: Json }
      get_public_event: { Args: { p_id: string }; Returns: Json }
      get_public_event_image: { Args: { p_id: string }; Returns: string }
      get_public_events: {
        Args: {
          p_branch_ids?: string[]
          p_from?: string
          p_include_cancelled?: boolean
          p_region_ids?: string[]
          p_to?: string
        }
        Returns: Json
      }
      get_regions_tree: { Args: never; Returns: Json }
      get_review_waiting: { Args: Record<PropertyKey, never>; Returns: Json }
      get_task: { Args: { p_id: string }; Returns: Json }
      get_task_group: {
        Args: { p_id: string }
        Returns: Json
      }
      get_unread_notification_counts: {
        Args: never
        Returns: Json
      }
      get_user_audit_history: {
        Args: { _offset?: number; _target: string }
        Returns: {
          action: Database["public"]["Enums"]["user_audit_action"]
          actor_name: string
          created_at: string
          id: string
          new_value: string
          old_value: string
        }[]
      }
      get_user_branch: { Args: { _user_id: string }; Returns: string }
      get_user_region: { Args: { _user_id: string }; Returns: string }
      get_volunteer_application_count: { Args: never; Returns: number }
      get_work_request_count: {
        Args: never
        Returns: number
      }
      guest_cancel: { Args: { p_registration: string }; Returns: Json }
      guest_confirm: { Args: { p_registration: string }; Returns: Json }
      guest_event_open: {
        Args: {
          _e: Database["public"]["Tables"]["events"]["Row"]
        }
        Returns: boolean
      }
      guest_register: {
        Args: {
          p_email: string
          p_event: string
          p_keep_informed: boolean
          p_name: string
          p_phone: string
          p_places: number
        }
        Returns: Json
      }
      guest_registration_view: {
        Args: { p_registration: string }
        Returns: Json
      }
      has_accepted_privacy_notice: { Args: never; Returns: boolean }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _uid: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      in_work_scope: {
        Args: {
          _branch: string
          _region: string
          _scope: string
          _user: string
        }
        Returns: boolean
      }
      is_active_nc: { Args: { _uid: string }; Returns: boolean }
      is_active_person: { Args: { _uid: string }; Returns: boolean }
      is_branch_member: {
        Args: { _branch: string; _uid: string }
        Returns: boolean
      }
      is_follower: { Args: { _uid: string }; Returns: boolean }
      is_member: { Args: { _uid: string }; Returns: boolean }
      is_nc: { Args: never; Returns: boolean }
      is_public_event: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      json_uuid_array: { Args: { p: Json }; Returns: string[] }
      list_deleted_events: {
        Args: { _offset?: number }
        Returns: {
          cleanup_pending: boolean
          deleted_at: string
          deleted_by: string
          id: string
          start_at: string
          status: string
          title: string
        }[]
      }
      list_event_request_media: {
        Args: { p_request_id: string }
        Returns: Json
      }
      list_event_videos: {
        Args: { p_event: string }
        Returns: {
          has_thumb: boolean
          id: string
          position: number
          title: string
          youtube_id: string
        }[]
      }
      list_managed_event_requests: {
        Args: { p_offset?: number; p_status?: string }
        Returns: Json
      }
      list_media_download_requests: {
        Args: { p_box: string }
        Returns: Json
      }
      list_media_targets: {
        Args: { p_branch: string }
        Returns: Json
      }
      list_media_upload_requests: {
        Args: { p_box: string }
        Returns: Json
      }
      list_meeting_carry_over: {
        Args: { p_branch?: string; p_region?: string; p_scope: string }
        Returns: Json
      }
      list_meeting_people: {
        Args: { p_branch?: string; p_region?: string; p_scope: string }
        Returns: Json
      }
      list_meeting_requests_to_review: {
        Args: { p_filter?: string }
        Returns: Json
      }
      list_meetings: {
        Args: { p_limit?: number; p_when?: string }
        Returns: Json
      }
      list_my_event_requests: { Args: never; Returns: Json }
      list_my_meeting_requests: {
        Args: never
        Returns: Json
      }
      list_my_notifications: { Args: { p_limit?: number }; Returns: Json }
      list_my_notifications_page: {
        Args: { p_before?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_my_push_subscriptions: {
        Args: { p_endpoint?: string }
        Returns: Json
      }
      list_my_task_requests: { Args: never; Returns: Json }
      list_my_volunteer_applications: { Args: never; Returns: Json }
      list_my_work_scopes: { Args: never; Returns: Json }
      list_recycle_bin: {
        Args: { _offset?: number; _search?: string; _type?: string }
        Returns: {
          branch: string
          can_restore: boolean
          days_left: number
          deleted_at: string
          deleted_by_name: string
          event_count: number
          id: string
          region: string
          role: string
          self_requested: boolean
          title: string
          total_count: number
          type: string
        }[]
      }
      list_request_targets: { Args: never; Returns: Json }
      list_task_groups: {
        Args: never
        Returns: Json
      }
      list_task_mention_people: { Args: { p_task: string }; Returns: Json }
      list_task_notes: { Args: { p_task: string }; Returns: Json }
      list_task_people: {
        Args: { p_branch?: string; p_region?: string; p_scope: string }
        Returns: Json
      }
      list_task_requests_to_review: {
        Args: { p_filter?: string }
        Returns: Json
      }
      list_task_sources: { Args: never; Returns: Json }
      list_tasks: { Args: never; Returns: Json }
      list_volunteer_applications: {
        Args: { p_filter?: string }
        Returns: Json
      }
      manager_update_event_request: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      mark_attendance: {
        Args: { p_registration_id: string; p_status: string }
        Returns: undefined
      }
      mark_media_chapter_viewed: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: { p_entity_id?: string; p_entity_type?: string; p_id?: string }
        Returns: number
      }
      mark_welcome_seen: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      media_cleanup_paths: {
        Args: never
        Returns: Json
      }
      media_download_files: {
        Args: { p_id: string; p_user: string }
        Returns: Json
      }
      meeting_add_agenda: {
        Args: { _meeting: string; _standing: boolean; _titles: string[] }
        Returns: undefined
      }
      meeting_apply_quiet: {
        Args: {
          _old: Database["public"]["Tables"]["meetings"]["Row"]
          p: Json
        }
        Returns: undefined
      }
      meeting_editable: { Args: { _meeting: string }; Returns: undefined }
      meeting_fields: {
        Args: {
          _m: Database["public"]["Tables"]["meetings"]["Row"]
          p: Json
        }
        Returns: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          ends_at: string
          id: string
          location: string | null
          location_type: string
          online_url: string | null
          purge_requested_at: string | null
          region_id: string | null
          scope: string
          source_request_id: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meetings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      meeting_insert: {
        Args: {
          _branch: string
          _invitees: string[]
          _region: string
          _scope: string
          _source: string
          p: Json
        }
        Returns: string
      }
      meeting_json: {
        Args: {
          _m: Database["public"]["Tables"]["meetings"]["Row"]
        }
        Returns: Json
      }
      meeting_locked: {
        Args: { _id: string }
        Returns: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          ends_at: string
          id: string
          location: string | null
          location_type: string
          online_url: string | null
          purge_requested_at: string | null
          region_id: string | null
          scope: string
          source_request_id: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meetings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      meeting_occurrence_times: {
        Args: {
          _count: number
          _end: string
          _freq: string
          _interval: number
          _start: string
        }
        Returns: {
          ends_at: string
          i: number
          starts_at: string
        }[]
      }
      meeting_request_json: {
        Args: {
          _r: Database["public"]["Tables"]["meeting_requests"]["Row"]
        }
        Returns: Json
      }
      meeting_request_locked: {
        Args: { _id: string }
        Returns: {
          branch_id: string | null
          created_at: string
          decline_reason: string | null
          id: string
          meeting_id: string | null
          note: string | null
          proposed_times: NonNullable<Json>
          region_id: string | null
          requester_id: string | null
          reviewed_at: string | null
          scope: string
          status: string
          target_id: string | null
          topic: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meeting_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      meeting_set_invitees: {
        Args: {
          _ids: string[]
          _m: Database["public"]["Tables"]["meetings"]["Row"]
        }
        Returns: string[]
      }
      meeting_sync: { Args: { _on: boolean }; Returns: undefined }
      meeting_sync_active: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      move_agenda_item: {
        Args: { p_direction: number; p_id: string }
        Returns: undefined
      }
      notice_email_context: { Args: { p_id: string }; Returns: Json }
      move_media_photos: {
        Args: { p_commit?: boolean; p_items: Json; p_target: Json }
        Returns: Json
      }
      notice_email_unsubscribe: {
        Args: { p_type: string; p_user: string }
        Returns: string
      }
      notification_default_delivery: {
        Args: { _user: string }
        Returns: string
      }
      notification_delivery_locked: {
        Args: { _type: string }
        Returns: boolean
      }
      notification_email_mode: { Args: { _kind: string }; Returns: string }
      notification_email_on: {
        Args: { _type: string; _user: string }
        Returns: boolean
      }
      notification_email_set: {
        Args: { _on: boolean; _type: string; _user: string }
        Returns: undefined
      }
      notification_email_timing: { Args: { _type: string }; Returns: string }
      notification_setting: {
        Args: { _type: string; _user: string }
        Returns: Json
      }
      notification_type: { Args: { _kind: string }; Returns: string }
      notification_type_locked: { Args: { _type: string }; Returns: boolean }
      notify: {
        Args: {
          _entity_id: string
          _entity_type: string
          _kind: string
          _link: string
          _payload?: Json
          _title: string
          _user: string
        }
        Returns: string
      }
      open_series: { Args: { _series: string }; Returns: Json }
      other_active_nc_exists: { Args: { _except: string }; Returns: boolean }
      outbox_flush_due: { Args: never; Returns: boolean }
      outbox_flush_tick: { Args: never; Returns: undefined }
      permanent_delete_item: {
        Args: { _confirmation: string; _id: string; _type: string }
        Returns: Json
      }
      prepare_user_purge: {
        Args: { _actor?: string; _id: string }
        Returns: Json
      }
      privacy_notice_version: { Args: never; Returns: string }
      promote_waitlist: { Args: { _event: string }; Returns: number }
      public_event_image_path: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      public_event_json: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      public_landing_data: { Args: Record<PropertyKey, never>; Returns: Json }
      public_rate_hit: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      public_registration_state: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      purge_event: {
        Args: { _event: string; _finalize?: boolean }
        Returns: Json
      }
      purge_event_request: {
        Args: { _finalize?: boolean; _id: string }
        Returns: Json
      }
      purge_expired_event_requests: { Args: never; Returns: number }
      purge_expired_series: { Args: never; Returns: number }
      purge_expired_structure: { Args: never; Returns: number }
      purge_expired_volunteer_applications: { Args: never; Returns: number }
      purge_expired_work_items: {
        Args: never
        Returns: number
      }
      purge_guest_data: { Args: Record<PropertyKey, never>; Returns: Json }
      purge_meeting: {
        Args: { _finalize?: boolean; _id: string }
        Returns: Json
      }
      purge_structure_item: {
        Args: { _id: string; _type: string }
        Returns: Json
      }
      purge_volunteer_application_item: { Args: { _id: string }; Returns: Json }
      purge_work_item: { Args: { _id: string; _type: string }; Returns: Json }
      record_privacy_choices: {
        Args: { _photo: boolean; _updates: boolean; _user: string }
        Returns: undefined
      }
      record_user_deletion: {
        Args: { _actor: string; _audit: string; _target: string }
        Returns: undefined
      }
      record_user_deletion_failure: {
        Args: { _actor: string; _audit: string; _target: string }
        Returns: undefined
      }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: Json
      }
      register_for_event: {
        Args: { p_event_id: string; p_show_name?: boolean }
        Returns: Json
      }
      registrant_names_visible: { Args: { _event: string }; Returns: boolean }
      registration_counts: {
        Args: { _event: string }
        Returns: {
          attended: number
          cancelled: number
          no_show: number
          seats: number
          waitlisted: number
        }[]
      }
      registration_position: {
        Args: { _r: Database["public"]["Tables"]["event_registrations"]["Row"] }
        Returns: number
      }
      registration_public_names: { Args: { _event: string }; Returns: Json }
      registration_reachable: {
        Args: {
          _r: Database["public"]["Tables"]["event_registrations"]["Row"]
        }
        Returns: boolean
      }
      registration_result: {
        Args: { _r: Database["public"]["Tables"]["event_registrations"]["Row"] }
        Returns: Json
      }
      remove_media_upload_file: {
        Args: { p_id: string }
        Returns: Json
      }
      rename_branch: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      rename_region: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      reorder_event_media: {
        Args: { _event: string; _ids: string[] }
        Returns: undefined
      }
      request_account_deletion: { Args: never; Returns: string }
      reorder_media_photos: {
        Args: { p_album: string; p_ids: string[] }
        Returns: undefined
      }
      request_media_download: {
        Args: { p_items: Json; p_reason?: string }
        Returns: string
      }
      request_scope_of: {
        Args: { _requester: string }
        Returns: Record<string, unknown>
      }
      request_target_ok: {
        Args: { _requester: string; _target: string }
        Returns: boolean
      }
      require_nc: { Args: never; Returns: undefined }
      require_privacy_accepted: { Args: never; Returns: undefined }
      restore_event: {
        Args: { _event: string; _finalize?: boolean }
        Returns: Json
      }
      restore_event_request: { Args: { _id: string }; Returns: Json }
      restore_item: { Args: { _id: string; _type: string }; Returns: Json }
      restore_series: {
        Args: { _finalize?: boolean; _series: string }
        Returns: Json
      }
      restore_structure: { Args: { _id: string; _type: string }; Returns: Json }
      restore_volunteer_application: { Args: { _id: string }; Returns: Json }
      restore_work_item: { Args: { _id: string; _type: string }; Returns: Json }
      review_notice_refresh: { Args: { _user: string }; Returns: undefined }
      review_waiting_for: { Args: { _user: string }; Returns: Json }
      run_notification_digest: { Args: { p_now?: string }; Returns: number }
      run_task_reminders: { Args: { p_now?: string }; Returns: number }
      run_media_nudges: {
        Args: { p_now?: string }
        Returns: number
      }
      scope_people: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: Json
      }
      scope_reviewers: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: string[]
      }
      series_expand: {
        Args: {
          _dtstart: string
          _from: string
          _limit: number
          _rule: string
          _to: string
        }
        Returns: string[]
      }
      series_generate: {
        Args: { _limit?: number; _series: string }
        Returns: number
      }
      series_op_begin: { Args: never; Returns: string }
      series_op_end: { Args: { _prev: string }; Returns: undefined }
      series_rule_count: {
        Args: { _count: number; _rule: string }
        Returns: string
      }
      series_rule_until: {
        Args: { _all_day: boolean; _before: string; _rule: string }
        Returns: string
      }
      series_timing: { Args: { _data: Json }; Returns: Record<string, unknown> }
      session_ok: { Args: never; Returns: boolean }
      set_agenda_item_resolved: {
        Args: { p_id: string; p_resolved: boolean }
        Returns: boolean
      }
      set_branch_coordinates: {
        Args: {
          p_branch: string
          p_lat: number
          p_lng: number
          p_postcode: string
        }
        Returns: undefined
      }
      set_branch_postcode: {
        Args: { p_branch: string; p_postcode: string }
        Returns: string
      }
      set_consent_preferences: {
        Args: { p_photo_consent: boolean; p_updates_email_consent: boolean }
        Returns: Json
      }
      set_event_coordinates: {
        Args: {
          p_event: string
          p_lat: number
          p_lng: number
          p_postcode: string
        }
        Returns: undefined
      }
      set_event_media_gallery: {
        Args: { p_in_gallery: boolean; p_media: string }
        Returns: undefined
      }
      set_event_media_size: {
        Args: { p_height: number; p_media: string; p_width: number }
        Returns: undefined
      }
      set_event_media_variants: {
        Args: { p_media: string }
        Returns: undefined
      }
      set_event_postcode: {
        Args: { p_event: string; p_postcode: string }
        Returns: string
      }
      set_event_video_thumb: {
        Args: { p_id: string; p_path: string }
        Returns: undefined
      }
      set_media_album_cover: {
        Args: { p_album: string; p_photo: string | null }
        Returns: undefined
      }
      set_media_highlight: {
        Args: { p_id: string; p_on: boolean; p_source: string }
        Returns: undefined
      }
      set_meeting_invitees: {
        Args: { p_id: string; p_invitee_ids: Json }
        Returns: number
      }
      set_meeting_series_agenda: {
        Args: { p_id: string; p_titles: Json }
        Returns: number
      }
      set_meeting_status: {
        Args: { p_id: string; p_status: string }
        Returns: string
      }
      set_my_task_reminders: {
        Args: { p_id: string; p_reminders: Json }
        Returns: Json
      }
      set_notification_email: {
        Args: { p_on: boolean; p_type: string }
        Returns: Json
      }
      set_notification_push: {
        Args: { p_on: boolean; p_type: string }
        Returns: Json
      }
      set_notification_setting: {
        Args: { p_delivery: string; p_enabled: boolean; p_type: string }
        Returns: Json
      }
      set_registration_show_name: {
        Args: { p_event_id: string; p_show_name: boolean }
        Returns: undefined
      }
      set_task_group_members: {
        Args: { p_add?: Json; p_id: string; p_remove?: Json }
        Returns: Json
      }
      set_task_reminder_emails: { Args: { p_on: boolean }; Returns: boolean }
      set_task_reminder_mute: {
        Args: { p_id: string; p_muted: boolean }
        Returns: boolean
      }
      set_task_status: {
        Args: { p_id: string; p_status: string }
        Returns: string
      }
      set_user_branch: {
        Args: { _branch: string; _target: string }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          _region?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
      set_user_status: {
        Args: {
          _status: Database["public"]["Enums"]["profile_status"]
          _target: string
        }
        Returns: undefined
      }
      start_review_event_request: { Args: { p_id: string }; Returns: undefined }
      structure_in_use: {
        Args: { _id: string; _type: string }
        Returns: boolean
      }
      submit_event_request: { Args: { p: Json }; Returns: string }
      submit_meeting_request: { Args: { p: Json }; Returns: string }
      submit_task_request: { Args: { p: Json }; Returns: string }
      submit_volunteer_application: { Args: { p: Json }; Returns: string }
      subscriber_confirm: { Args: { p_id: string }; Returns: Json }
      submit_media_upload_request: {
        Args: { p_id: string }
        Returns: Json
      }
      subscriber_signup: {
        Args: {
          p_branch: string
          p_email: string
          p_name: string
          p_source: string
        }
        Returns: Json
      }
      subscriber_unsubscribe: { Args: { p_id: string }; Returns: Json }
      task_assignee_ok: {
        Args: {
          _branch: string
          _region: string
          _scope: string
          _user: string
        }
        Returns: boolean
      }
      task_fields: {
        Args: {
          _t: Database["public"]["Tables"]["tasks"]["Row"]
          p: Json
        }
        Returns: {
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          decision_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          event_id: string | null
          id: string
          meeting_id: string | null
          overdue_every_days: number | null
          priority: string
          region_id: string | null
          remind_before_days: number[]
          repeat_every_days: number | null
          repeat_kind: string
          repeat_start: string | null
          scope: string
          self_task: boolean
          source_request_id: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_group_people: {
        Args: { _branch: string; _region: string }
        Returns: string[]
      }
      task_group_status: {
        Args: { _group: string }
        Returns: string
      }
      task_group_trash_task: {
        Args: { _task: string }
        Returns: undefined
      }
      task_insert: {
        Args: {
          _assignees: string[]
          _branch: string
          _region: string
          _scope: string
          _source: string
          p: Json
        }
        Returns: string
      }
      task_json: {
        Args: {
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: Json
      }
      task_locked: {
        Args: { _id: string }
        Returns: {
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          decision_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          event_id: string | null
          id: string
          meeting_id: string | null
          overdue_every_days: number | null
          priority: string
          region_id: string | null
          remind_before_days: number[]
          repeat_every_days: number | null
          repeat_kind: string
          repeat_start: string | null
          scope: string
          self_task: boolean
          source_request_id: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_note_mentions: {
        Args: { _task: string; p: Json }
        Returns: string[]
      }
      task_note_notice: {
        Args: {
          _note: string
          _t: Database["public"]["Tables"]["tasks"]["Row"]
          _user: string
        }
        Returns: undefined
      }
      task_note_notices: {
        Args: {
          _mentions: string[]
          _note: string
          _previous: string[]
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: undefined
      }
      task_reminder_kind: {
        Args: {
          _day: string
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: string
      }
      task_request_json: {
        Args: {
          _r: Database["public"]["Tables"]["task_requests"]["Row"]
        }
        Returns: Json
      }
      task_request_locked: {
        Args: { _id: string }
        Returns: {
          branch_id: string | null
          created_at: string
          decline_reason: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          region_id: string | null
          requester_id: string | null
          reviewed_at: string | null
          scope: string
          status: string
          target_id: string | null
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_set_assignees: {
        Args: {
          _ids: string[]
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: string[]
      }
      task_status_notice: {
        Args: {
          _old: string
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: undefined
      }
      task_viewer: { Args: { _task: string; _uid: string }; Returns: boolean }
      task_visible_to: {
        Args: { _task: string; _uid: string }
        Returns: boolean
      }
      task_with_reminders: {
        Args: {
          _r: Json
          _t: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          decision_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          event_id: string | null
          id: string
          meeting_id: string | null
          overdue_every_days: number | null
          priority: string
          region_id: string | null
          remind_before_days: number[]
          repeat_every_days: number | null
          repeat_kind: string
          repeat_start: string | null
          scope: string
          self_task: boolean
          source_request_id: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unfollow_branch: { Args: { p_branch_id: string }; Returns: undefined }
      unregister_push_subscription: {
        Args: { p_endpoint?: string; p_id?: string }
        Returns: boolean
      }
      update_agenda_item: {
        Args: { p_id: string; p_notes?: string; p_title: string }
        Returns: undefined
      }
      update_event: {
        Args: { _data: Json; _event: string }
        Returns: undefined
      }
      update_event_request: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      update_meeting: { Args: { p: Json; p_id: string }; Returns: string }
      update_media_album: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      update_meeting_decision: {
        Args: { p_id: string; p_text: string }
        Returns: undefined
      }
      update_meeting_series: {
        Args: { p: Json; p_id: string; p_mode: string }
        Returns: number
      }
      update_past_event: {
        Args: {
          p_branch: string
          p_date: string
          p_description: string
          p_id: string
          p_title: string
        }
        Returns: undefined
      }
      update_series_event: {
        Args: { _data: Json; _event: string; _mode: string; _rule?: string }
        Returns: Json
      }
      update_task: { Args: { p: Json; p_id: string }; Returns: string }
      update_task_group: {
        Args: { p: Json; p_id: string }
        Returns: string
      }
      update_task_note: {
        Args: { p_body: string; p_id: string; p_mentions?: Json }
        Returns: string
      }
      user_manages_scope: {
        Args: {
          _branch: string
          _region: string
          _scope: string
          _user: string
        }
        Returns: boolean
      }
      wants_task_reminder_emails: { Args: { _user: string }; Returns: boolean }
      withdraw_event_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_meeting_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_task_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_media_download_request: {
        Args: { p_id: string }
        Returns: undefined
      }
      withdraw_media_upload_request: {
        Args: { p_id: string }
        Returns: Json
      }
      withdraw_volunteer_application: {
        Args: { p_id: string }
        Returns: undefined
      }
      work_actor: { Args: never; Returns: string }
      work_scope_valid: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "regional_director"
        | "branch_manager"
        | "volunteer"
        | "follower"
        | "national_coordinator"
        | "trustee"
      deletion_request_status: "pending" | "cancelled" | "completed"
      profile_status: "pending" | "active" | "inactive"
      user_audit_action:
        | "status_change"
        | "role_change"
        | "branch_change"
        | "user_deleted"
        | "deletion_requested"
        | "deletion_cancelled"
        | "user_deletion_failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "regional_director",
        "branch_manager",
        "volunteer",
        "follower",
        "national_coordinator",
        "trustee",
      ],
      deletion_request_status: ["pending", "cancelled", "completed"],
      profile_status: ["pending", "active", "inactive"],
      user_audit_action: [
        "status_change",
        "role_change",
        "branch_change",
        "user_deleted",
        "deletion_requested",
        "deletion_cancelled",
        "user_deletion_failed",
      ],
    },
  },
} as const
