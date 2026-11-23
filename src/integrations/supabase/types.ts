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
          id: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_with_region: boolean
          name: string
          region_id: string
        }
        Insert: {
          id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_region?: boolean
          name: string
          region_id: string
        }
        Update: {
          id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_with_region?: boolean
          name?: string
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
          created_at: string
          id: string
          last_error: string | null
          notification_id: string | null
          payload: NonNullable<Json>
          sent_at: string | null
          status: string
          template: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id?: string | null
          payload?: NonNullable<Json>
          sent_at?: string | null
          status?: string
          template: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id?: string | null
          payload?: NonNullable<Json>
          sent_at?: string | null
          status?: string
          template?: string
          user_id?: string
        }
        Relationships: [
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
      event_media: {
        Row: {
          created_at: string
          event_id: string
          id: string
          kind: string
          original_name: string | null
          position: number
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          kind: string
          original_name?: string | null
          position: number
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          kind?: string
          original_name?: string | null
          position?: number
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
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
          id: string
          notice: string | null
          notice_seen_at: string | null
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
          id?: string
          notice?: string | null
          notice_seen_at?: string | null
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
          id?: string
          notice?: string | null
          notice_seen_at?: string | null
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
          id: string
          is_external: boolean
          location: string
          location_type: string
          online_url: string | null
          organizer: string
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
          id?: string
          is_external?: boolean
          location?: string
          location_type?: string
          online_url?: string | null
          organizer: string
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
          id?: string
          is_external?: boolean
          location?: string
          location_type?: string
          online_url?: string | null
          organizer?: string
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
          created_at: string
          id: string
          meeting_id: string
          notes: string | null
          position: number
          title: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          meeting_id: string
          notes?: string | null
          position: number
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_id?: string
          notes?: string | null
          position?: number
          title?: string
        }
        Relationships: [
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
        ComputedFields: never
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
        ComputedFields: never
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
        ComputedFields: never
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
          meeting_request_json: Json | null
        }
        ComputedFields: "meeting_request_json"
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
      meetings: {
        Row: {
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
          meeting_json: Json | null
        }
        ComputedFields: "meeting_json"
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          ends_at: string
          id?: string
          location?: string | null
          location_type?: string
          online_url?: string | null
          purge_requested_at?: string | null
          region_id?: string | null
          scope: string
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
          id?: string
          location?: string | null
          location_type?: string
          online_url?: string | null
          purge_requested_at?: string | null
          region_id?: string | null
          scope?: string
          source_request_id?: string | null
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
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
      notification_preferences: {
        Row: {
          task_reminder_emails: boolean
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          task_reminder_emails?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          task_reminder_emails?: boolean
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
          entity_id: string
          entity_type: string
          id: string
          kind: string
          link: string
          payload: NonNullable<Json>
          read_at: string | null
          title: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
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
          entity_id?: string
          entity_type?: string
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
      recycle_bin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          branch_id: string | null
          created_at: string
          id: string
          item_id: string
          item_type: string
          region_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          region_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          region_id?: string
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
          id: string
          deleted_at: string | null
          deleted_by: string | null
          name: string
        }
        Insert: {
          id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          name: string
        }
        Update: {
          id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          name?: string
        }
        Relationships: []
      }
      task_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          reminders_muted: boolean
          task_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          assigned_by?: string | null
          created_at?: string
          reminders_muted?: boolean
          task_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
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
      task_reminder_log: {
        Row: {
          created_at: string
          day: string
          kind: string
          task_id: string
          user_id: string
        }
        ComputedFields: never
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
          task_request_json: Json | null
        }
        ComputedFields: "task_request_json"
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
          task_json: Json | null
        }
        ComputedFields: "task_json"
        Insert: {
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
        Relationships: []
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
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability?: string | null
          branch_id: string
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
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability?: string | null
          branch_id?: string
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
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_task_request: { Args: { p_id: string }; Returns: string }
      add_agenda_item: {
        Args: { p_meeting: string; p_notes?: string; p_title: string }
        Returns: string
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
      approve_meeting_request: {
        Args: { p_id: string; p_meeting: Json }
        Returns: string
      }
      authorize_follower_self_deletion: {
        Args: { _target: string }
        Returns: string
      }
      create_meeting: { Args: { p: Json }; Returns: string }
      create_task: { Args: { p: Json }; Returns: string }
      decline_meeting_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      decline_task_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_agenda_item: { Args: { p_id: string }; Returns: undefined }
      delete_meeting: { Args: { p_id: string }; Returns: undefined }
      delete_meeting_decision: { Args: { p_id: string }; Returns: undefined }
      delete_meeting_file: { Args: { p_id: string }; Returns: undefined }
      delete_task: { Args: { p_id: string }; Returns: undefined }
      get_event_tasks: { Args: { p_event: string }; Returns: Json }
      get_meeting: { Args: { p_id: string }; Returns: Json }
      get_my_task_summary: { Args: Record<PropertyKey, never>; Returns: Json }
      get_notification_preferences: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_task: { Args: { p_id: string }; Returns: Json }
      get_unread_notification_counts: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_work_request_count: {
        Args: Record<PropertyKey, never>
        Returns: number
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
      list_my_meeting_requests: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      list_my_notifications: { Args: { p_limit?: number }; Returns: Json }
      list_my_task_requests: { Args: Record<PropertyKey, never>; Returns: Json }
      list_my_work_scopes: { Args: Record<PropertyKey, never>; Returns: Json }
      list_request_targets: { Args: Record<PropertyKey, never>; Returns: Json }
      list_task_people: {
        Args: { p_branch?: string; p_region?: string; p_scope: string }
        Returns: Json
      }
      list_task_requests_to_review: {
        Args: { p_filter?: string }
        Returns: Json
      }
      list_tasks: { Args: Record<PropertyKey, never>; Returns: Json }
      mark_notifications_read: {
        Args: { p_entity_id?: string; p_entity_type?: string; p_id?: string }
        Returns: number
      }
      move_agenda_item: {
        Args: { p_direction: number; p_id: string }
        Returns: undefined
      }
      purge_expired_structure: { Args: never; Returns: number }
      purge_expired_volunteer_applications: { Args: never; Returns: number }
      approve_volunteer_application: { Args: { p_id: string }; Returns: undefined }
      create_branch: { Args: { p_name: string; p_region_id: string }; Returns: string }
      create_region: { Args: { p_name: string }; Returns: string }
      decline_volunteer_application: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_branch: { Args: { p_id: string }; Returns: undefined }
      delete_region: { Args: { p_id: string }; Returns: undefined }
      delete_volunteer_application: { Args: { p_id: string }; Returns: undefined }
      follow_branch: { Args: { p_branch_id: string }; Returns: undefined }
      get_followed_branches: { Args: never; Returns: Json }
      get_nc_dashboard: { Args: never; Returns: Json }
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
      get_volunteer_application_count: { Args: never; Returns: number }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _uid: string
        }
        Returns: boolean
      }
      is_follower: { Args: { _uid: string }; Returns: boolean }
      is_member: { Args: { _uid: string }; Returns: boolean }
      is_nc: { Args: never; Returns: boolean }
      list_my_volunteer_applications: { Args: never; Returns: Json }
      list_volunteer_applications: {
        Args: { p_filter?: string }
        Returns: Json
      }
      purge_expired_work_items: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      purge_meeting: {
        Args: { _finalize?: boolean; _id: string }
        Returns: Json
      }
      rename_branch: { Args: { p_id: string; p_name: string }; Returns: undefined }
      rename_region: { Args: { p_id: string; p_name: string }; Returns: undefined }
      run_task_reminders: { Args: { p_now?: string }; Returns: number }
      session_ok: { Args: never; Returns: boolean }
      set_meeting_status: {
        Args: { p_id: string; p_status: string }
        Returns: string
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
      submit_meeting_request: { Args: { p: Json }; Returns: string }
      submit_task_request: { Args: { p: Json }; Returns: string }
      submit_volunteer_application: { Args: { p: Json }; Returns: string }
      unfollow_branch: { Args: { p_branch_id: string }; Returns: undefined }
      update_agenda_item: {
        Args: { p_id: string; p_notes?: string; p_title: string }
        Returns: undefined
      }
      update_meeting: { Args: { p: Json; p_id: string }; Returns: string }
      update_meeting_decision: {
        Args: { p_id: string; p_text: string }
        Returns: undefined
      }
      update_task: { Args: { p: Json; p_id: string }; Returns: string }
      withdraw_meeting_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_task_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_volunteer_application: {
        Args: { p_id: string }
        Returns: undefined
      }
      accept_privacy_notice: { Args: { p_version: string }; Returns: Json }
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
      approve_event_request: {
        Args: { p_audience?: string; p_id: string }
        Returns: Json
      }
      authorize_user_deletion: {
        Args: { _actor: string; _request?: string; _target: string }
        Returns: string
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
      can_restore_event: { Args: { _event: string }; Returns: boolean }
      can_review_event_request: {
        Args: { _r: Database["public"]["Tables"]["event_requests"]["Row"] }
        Returns: boolean
      }
      can_view_event: { Args: { _event: string }; Returns: boolean }
      can_view_event_media: { Args: { _event: string }; Returns: boolean }
      can_view_series: { Args: { _series: string }; Returns: boolean }
      can_write_event_file: { Args: { _path: string }; Returns: boolean }
      can_write_event_request_file: {
        Args: { _path: string }
        Returns: boolean
      }
      cancel_account_deletion: { Args: never; Returns: undefined }
      cancel_event: { Args: { _event: string }; Returns: undefined }
      cancel_registration: { Args: { p_event_id: string }; Returns: Json }
      create_event: { Args: { _data: Json }; Returns: string }
      create_series: { Args: { _data: Json; _rule: string }; Returns: Json }
      decline_event_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
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
      delete_series: { Args: { _event: string; _mode: string }; Returns: Json }
      dismiss_event_request_notice: {
        Args: { p_id: string }
        Returns: undefined
      }
      dismiss_registration_notice: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      event_ends: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      event_has_registrations: { Args: { _event: string }; Returns: boolean }
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
      event_starts: {
        Args: { _e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      extend_all_series: { Args: never; Returns: number }
      finish_series_deletion: { Args: { _series: string }; Returns: Json }
      finish_series_purge: { Args: { _series: string }; Returns: undefined }
      finish_user_recycle_operation: {
        Args: { _id: string; _operation: string }
        Returns: undefined
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
      get_pending_event_request_count: { Args: never; Returns: Json }
      get_privacy_status: { Args: never; Returns: Json }
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
      has_accepted_privacy_notice: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
      list_managed_event_requests: {
        Args: { p_offset?: number; p_status?: string }
        Returns: Json
      }
      list_my_event_requests: { Args: never; Returns: Json }
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
      manager_update_event_request: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      mark_attendance: {
        Args: { p_registration_id: string; p_status: string }
        Returns: undefined
      }
      open_series: { Args: { _series: string }; Returns: Json }
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
      registration_result: {
        Args: { _r: Database["public"]["Tables"]["event_registrations"]["Row"] }
        Returns: Json
      }
      reorder_event_media: {
        Args: { _event: string; _ids: string[] }
        Returns: undefined
      }
      request_account_deletion: { Args: never; Returns: string }
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
      set_consent_preferences: {
        Args: { p_photo_consent: boolean; p_updates_email_consent: boolean }
        Returns: Json
      }
      set_registration_show_name: {
        Args: { p_event_id: string; p_show_name: boolean }
        Returns: undefined
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
      submit_event_request: { Args: { p: Json }; Returns: string }
      update_event: {
        Args: { _data: Json; _event: string }
        Returns: undefined
      }
      update_event_request: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      update_series_event: {
        Args: { _data: Json; _event: string; _mode: string; _rule?: string }
        Returns: Json
      }
      withdraw_event_request: { Args: { p_id: string }; Returns: undefined }
    }
    Enums: {
      app_role:
        | "regional_director"
        | "branch_manager"
        | "volunteer"
        | "follower"
        | "national_coordinator"
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
