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
          name: string
          region_id: string
        }
        Insert: {
          id?: string
          name: string
          region_id: string
        }
        Update: {
          id?: string
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
        Relationships: []
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
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
          created_at: string
          decline_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          event_id: string | null
          expected_attendees: number | null
          id: string
          is_online: boolean
          location_text: string | null
          notice: string | null
          notice_seen_at: string | null
          online_url: string | null
          proposed_end: string | null
          proposed_end_date: string | null
          proposed_start: string | null
          proposed_start_date: string | null
          reason: string | null
          region_id: string
          requester_id: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          scope: string
          status: string
          title: string
          updated_at: string
          category: string | null
          last_edited_at: string | null
          last_edited_by: string | null
          notes: string | null
          organizer_name: string | null
          purge_requested_at: string | null
          request_type: string
          source: string | null
          source_url: string | null
        }
        Insert: {
          all_day?: boolean
          alt_end?: string | null
          alt_end_date?: string | null
          alt_start?: string | null
          alt_start_date?: string | null
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          event_id?: string | null
          expected_attendees?: number | null
          id?: string
          is_online?: boolean
          location_text?: string | null
          notice?: string | null
          notice_seen_at?: string | null
          online_url?: string | null
          proposed_end?: string | null
          proposed_end_date?: string | null
          proposed_start?: string | null
          proposed_start_date?: string | null
          reason?: string | null
          region_id: string
          requester_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope: string
          status?: string
          title: string
          updated_at?: string
          category?: string | null
          last_edited_at?: string | null
          last_edited_by?: string | null
          notes?: string | null
          organizer_name?: string | null
          purge_requested_at?: string | null
          request_type?: string
          source?: string | null
          source_url?: string | null
        }
        Update: {
          all_day?: boolean
          alt_end?: string | null
          alt_end_date?: string | null
          alt_start?: string | null
          alt_start_date?: string | null
          branch_id?: string | null
          created_at?: string
          decline_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          event_id?: string | null
          expected_attendees?: number | null
          id?: string
          is_online?: boolean
          location_text?: string | null
          notice?: string | null
          notice_seen_at?: string | null
          online_url?: string | null
          proposed_end?: string | null
          proposed_end_date?: string | null
          proposed_start?: string | null
          proposed_start_date?: string | null
          reason?: string | null
          region_id?: string
          requester_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope?: string
          status?: string
          title?: string
          updated_at?: string
          category?: string | null
          last_edited_at?: string | null
          last_edited_by?: string | null
          notes?: string | null
          organizer_name?: string | null
          purge_requested_at?: string | null
          request_type?: string
          source?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          all_day: boolean
          branch_id: string | null
          capacity: number | null
          registration_enabled: boolean
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
          region_id: string
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
          branch_id?: string | null
          capacity?: number | null
          registration_enabled?: boolean
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
          region_id: string
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
          branch_id?: string | null
          capacity?: number | null
          registration_enabled?: boolean
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
          region_id?: string
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
          is_external: boolean
          all_day: boolean
          branch_id: string | null
          capacity: number | null
          registration_enabled: boolean
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
          location: string
          location_type: string
          online_url: string | null
          organizer: string
          recurrence_key: string | null
          region_id: string
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
          is_external?: boolean
          all_day?: boolean
          branch_id?: string | null
          capacity?: number | null
          registration_enabled?: boolean
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
          location?: string
          location_type?: string
          online_url?: string | null
          organizer: string
          recurrence_key?: string | null
          region_id: string
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
          is_external?: boolean
          all_day?: boolean
          branch_id?: string | null
          capacity?: number | null
          registration_enabled?: boolean
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
          location?: string
          location_type?: string
          online_url?: string | null
          organizer?: string
          recurrence_key?: string | null
          region_id?: string
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
        Relationships: []
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
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_privacy_notice: { Args: { p_version: string }; Returns: Json }
      get_privacy_status: { Args: never; Returns: Json }
      has_accepted_privacy_notice: { Args: never; Returns: boolean }
      privacy_notice_version: { Args: never; Returns: string }
      set_consent_preferences: { Args: { p_photo_consent: boolean; p_updates_email_consent: boolean }; Returns: Json }
      add_event_request_media: { Args: { p_extension: string; p_kind: string; p_original_name?: string; p_request_id: string }; Returns: Json }
      can_read_event_request_file: { Args: { _path: string }; Returns: boolean }
      can_write_event_request_file: { Args: { _path: string }; Returns: boolean }
      delete_event_request_media: { Args: { p_media_id: string }; Returns: undefined }
      get_event_request_duplicates: { Args: { p_id: string }; Returns: Json }
      list_event_request_media: { Args: { p_request_id: string }; Returns: Json }
      manager_update_event_request: { Args: { p: Json; p_id: string }; Returns: undefined }
      purge_event_request: { Args: { _finalize?: boolean; _id: string }; Returns: Json }
      approve_event_request: { Args: { p_id: string }; Returns: Json }
      decline_event_request: { Args: { p_id: string; p_reason: string }; Returns: undefined }
      delete_event_request: { Args: { p_id: string }; Returns: undefined }
      dismiss_event_request_notice: { Args: { p_id: string }; Returns: undefined }
      get_event_request: { Args: { p_id: string }; Returns: Json }
      get_pending_event_request_count: { Args: never; Returns: Json }
      list_managed_event_requests: { Args: { p_offset?: number; p_status?: string }; Returns: Json }
      list_my_event_requests: { Args: never; Returns: Json }
      purge_expired_event_requests: { Args: never; Returns: number }
      start_review_event_request: { Args: { p_id: string }; Returns: undefined }
      submit_event_request: { Args: { p: Json }; Returns: string }
      update_event_request: { Args: { p: Json; p_id: string }; Returns: undefined }
      withdraw_event_request: { Args: { p_id: string }; Returns: undefined }
      cancel_registration: { Args: { p_event_id: string }; Returns: Json }
      dismiss_registration_notice: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      get_event_registration_summary: {
        Args: { p_event_id: string }
        Returns: Json
      }
      get_event_registrations: {
        Args: { p_event_id: string }
        Returns: {
          attendance_marked_at: string | null
          attendance_marked_by_name: string | null
          cancelled_at: string | null
          email: string | null
          full_name: string | null
          id: string
          registered_at: string
          show_name: boolean
          status: string
          user_id: string | null
          waitlist_position: number | null
        }[]
      }
      get_my_registrations: {
        Args: never
        Returns: {
          all_day: boolean
          end_at: string | null
          end_date: string | null
          event_id: string
          event_removed: boolean
          event_status: string
          notice: string | null
          registration_id: string
          start_at: string | null
          start_date: string | null
          status: string
          title: string
          waitlist_position: number | null
        }[]
      }
      mark_attendance: {
        Args: { p_registration_id: string; p_status: string }
        Returns: undefined
      }
      register_for_event: {
        Args: { p_event_id: string; p_show_name?: boolean }
        Returns: Json
      }
      set_registration_show_name: {
        Args: { p_event_id: string; p_show_name: boolean }
        Returns: undefined
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
      can_restore_event: { Args: { _event: string }; Returns: boolean }
      can_view_event: { Args: { _event: string }; Returns: boolean }
      can_view_event_media: { Args: { _event: string }; Returns: boolean }
      can_view_series: { Args: { _series: string }; Returns: boolean }
      can_write_event_file: { Args: { _path: string }; Returns: boolean }
      cancel_account_deletion: { Args: never; Returns: undefined }
      cancel_event: { Args: { _event: string }; Returns: undefined }
      create_event: { Args: { _data: Json }; Returns: string }
      create_series: { Args: { _data: Json; _rule: string }; Returns: Json }
      delete_event: {
        Args: { _complete?: boolean; _event: string; _title?: string }
        Returns: Json
      }
      delete_event_media: { Args: { _media: string }; Returns: undefined }
      delete_series: { Args: { _event: string; _mode: string }; Returns: Json }
      event_has_registrations: { Args: { _event: string }; Returns: boolean }
      extend_all_series: { Args: never; Returns: number }
      finish_series_deletion: { Args: { _series: string }; Returns: Json }
      finish_series_purge: { Args: { _series: string }; Returns: undefined }
      finish_user_recycle_operation: {
        Args: { _id: string; _operation: string }
        Returns: undefined
      }
      get_event_deletion_state: { Args: { _event: string }; Returns: Json }
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
      open_series: { Args: { _series: string }; Returns: Json }
      permanent_delete_item: {
        Args: { _confirmation: string; _id: string; _type: string }
        Returns: Json
      }
      prepare_user_purge: {
        Args: { _actor?: string; _id: string }
        Returns: Json
      }
      purge_event: {
        Args: { _event: string; _finalize?: boolean }
        Returns: Json
      }
      purge_expired_series: { Args: never; Returns: number }
      record_user_deletion: {
        Args: { _actor: string; _audit: string; _target: string }
        Returns: undefined
      }
      record_user_deletion_failure: {
        Args: { _actor: string; _audit: string; _target: string }
        Returns: undefined
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
      series_timing: {
        Args: { _data: Json }
        Returns: Record<string, unknown>
      }
      set_user_branch: {
        Args: { _branch: string; _target: string }
        Returns: undefined
      }
      set_user_role: {
        Args: {
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
      update_event: {
        Args: { _data: Json; _event: string }
        Returns: undefined
      }
      update_series_event: {
        Args: { _data: Json; _event: string; _mode: string; _rule?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "regional_director" | "branch_manager" | "volunteer"
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
      app_role: ["regional_director", "branch_manager", "volunteer"],
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
