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
      events: {
        Row: {
          branch_id: string | null
          capacity: number | null
          category: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string
          end_at: string | null
          id: string
          location: string
          organizer: string
          region_id: string
          scope: string
          start_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          capacity?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          end_at?: string | null
          id?: string
          location?: string
          organizer: string
          region_id: string
          scope: string
          start_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          capacity?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          end_at?: string | null
          id?: string
          location?: string
          organizer?: string
          region_id?: string
          scope?: string
          start_at?: string
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
        ]
      }
      profiles: {
        Row: {
          branch_id: string | null
          created_at: string
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
      add_event_media: {
        Args: { _event: string; _extension: string; _kind: string }
        Returns: string
      }
      authorize_user_deletion: {
        Args: { _actor: string; _request?: string; _target: string }
        Returns: string
      }
      can_manage_event: { Args: { _event: string }; Returns: boolean }
      can_manage_event_scope: {
        Args: { _branch: string; _region: string; _scope: string }
        Returns: boolean
      }
      can_manage_user: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_read_event_file: { Args: { _path: string }; Returns: boolean }
      can_restore_event: { Args: { _event: string }; Returns: boolean }
      can_view_event: { Args: { _event: string }; Returns: boolean }
      can_write_event_file: { Args: { _path: string }; Returns: boolean }
      cancel_account_deletion: { Args: never; Returns: undefined }
      cancel_event: { Args: { _event: string }; Returns: undefined }
      create_event: { Args: { _data: Json }; Returns: string }
      delete_event: { Args: { _event: string; _title?: string }; Returns: Json }
      delete_event_media: { Args: { _media: string }; Returns: undefined }
      event_has_registrations: { Args: { _event: string }; Returns: boolean }
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
          deleted_at: string
          deleted_by: string
          id: string
          start_at: string
          status: string
          title: string
        }[]
      }
      purge_event: {
        Args: { _event: string; _finalize?: boolean }
        Returns: Json
      }
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
