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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      job_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: number
          job_id: number
          payload: Json
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: never
          job_id: number
          payload?: Json
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: never
          job_id?: number
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_stock_items: {
        Row: {
          assigned_at: string | null
          consumed_at: string | null
          created_at: string
          id: number
          job_id: number
          notes: string
          qty: number
          status: Database["public"]["Enums"]["job_stock_item_status"]
          stock_id: number
        }
        Insert: {
          assigned_at?: string | null
          consumed_at?: string | null
          created_at?: string
          id?: never
          job_id: number
          notes?: string
          qty: number
          status?: Database["public"]["Enums"]["job_stock_item_status"]
          stock_id: number
        }
        Update: {
          assigned_at?: string | null
          consumed_at?: string | null
          created_at?: string
          id?: never
          job_id?: number
          notes?: string
          qty?: number
          status?: Database["public"]["Enums"]["job_stock_item_status"]
          stock_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_stock_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_stock_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assigned_installer_id: string | null
          ces_received: string | null
          ces_submitted: string | null
          contact_method: string
          created_at: string
          date_booked: string | null
          email: string
          fixes_needed: boolean
          id: number
          install_date: string | null
          install_start: string | null
          job_order: Json | null
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          name: string
          notes: string
          phone: string
          rebate_received: string | null
          rebate_submitted: string | null
          stage: number
          step: number
          system_description: string
          updated_at: string
          value: number
          version: number
        }
        Insert: {
          assigned_installer_id?: string | null
          ces_received?: string | null
          ces_submitted?: string | null
          contact_method?: string
          created_at?: string
          date_booked?: string | null
          email?: string
          fixes_needed?: boolean
          id?: number
          install_date?: string | null
          install_start?: string | null
          job_order?: Json | null
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string
          name: string
          notes?: string
          phone?: string
          rebate_received?: string | null
          rebate_submitted?: string | null
          stage?: number
          step?: number
          system_description?: string
          updated_at?: string
          value?: number
          version?: number
        }
        Update: {
          assigned_installer_id?: string | null
          ces_received?: string | null
          ces_submitted?: string | null
          contact_method?: string
          created_at?: string
          date_booked?: string | null
          email?: string
          fixes_needed?: boolean
          id?: number
          install_date?: string | null
          install_start?: string | null
          job_order?: Json | null
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string
          name?: string
          notes?: string
          phone?: string
          rebate_received?: string | null
          rebate_submitted?: string | null
          stage?: number
          step?: number
          system_description?: string
          updated_at?: string
          value?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_installer_id_fkey"
            columns: ["assigned_installer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_stage_step_fkey"
            columns: ["stage", "step"]
            isOneToOne: false
            referencedRelation: "pipeline_steps"
            referencedColumns: ["stage", "step"]
          },
        ]
      }
      pipeline_steps: {
        Row: {
          ordinal: number
          stage: number
          stage_name: string
          step: number
          step_name: string
        }
        Insert: {
          ordinal: number
          stage: number
          stage_name: string
          step: number
          step_name: string
        }
        Update: {
          ordinal?: number
          stage?: number
          stage_name?: string
          step?: number
          step_name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      receipts: {
        Row: {
          created_at: string
          id: number
          invoice_ref: string
          item_count: number
          occurred_at: string
          supplier_id: number | null
          total_units: number
        }
        Insert: {
          created_at?: string
          id?: number
          invoice_ref?: string
          item_count?: number
          occurred_at?: string
          supplier_id?: number | null
          total_units?: number
        }
        Update: {
          created_at?: string
          id?: number
          invoice_ref?: string
          item_count?: number
          occurred_at?: string
          supplier_id?: number | null
          total_units?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ces_specs: {
        Row: {
          category: Database["public"]["Enums"]["ces_category"]
          kva: number | null
          kw: number | null
          kwh: number | null
          manufacturer: string
          model: string
          stock_id: number
          verified: boolean
          watts: number | null
        }
        Insert: {
          category: Database["public"]["Enums"]["ces_category"]
          kva?: number | null
          kw?: number | null
          kwh?: number | null
          manufacturer?: string
          model?: string
          stock_id: number
          verified?: boolean
          watts?: number | null
        }
        Update: {
          category?: Database["public"]["Enums"]["ces_category"]
          kva?: number | null
          kw?: number | null
          kwh?: number | null
          manufacturer?: string
          model?: string
          stock_id?: number
          verified?: boolean
          watts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ces_specs_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: true
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      stocks: {
        Row: {
          id: number
          name: string
          qty: number
          supplier_id: number | null
        }
        Insert: {
          id?: number
          name: string
          qty?: number
          supplier_id?: number | null
        }
        Update: {
          id?: number
          name?: string
          qty?: number
          supplier_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stocks_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          email: string
          id: number
          name: string
          notes: string
          phone: string
        }
        Insert: {
          email?: string
          id?: number
          name: string
          notes?: string
          phone?: string
        }
        Update: {
          email?: string
          id?: number
          name?: string
          notes?: string
          phone?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_job_stage: {
        Args: {
          p_date?: string
          p_expected_version: number
          p_job_id: number
          p_override_stage?: number
          p_override_step?: number
        }
        Returns: Database["public"]["Tables"]["jobs"]["Row"]
      }
      apply_pending_bom_now: { Args: { p_job_id: number }; Returns: number }
      move_job_back: {
        Args: { p_expected_version: number; p_job_id: number }
        Returns: Database["public"]["Tables"]["jobs"]["Row"]
      }
      receive_stock: {
        Args: {
          p_invoice_ref: string
          p_lines: Json
          p_occurred_at: string | null
          p_supplier_id: number | null
        }
        Returns: Database["public"]["Tables"]["receipts"]["Row"]
      }
      reschedule_booking: {
        Args: {
          p_expected_version: number
          p_job_id: number
          p_new_date: string
        }
        Returns: Database["public"]["Tables"]["jobs"]["Row"]
      }
    }
    Enums: {
      ces_category: "battery" | "inverter" | "panel" | "other"
      job_stock_item_status: "pending" | "assigned" | "consumed"
      job_type: "install" | "service"
      user_role: "admin" | "installer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      ces_category: ["battery", "inverter", "panel", "other"],
      job_stock_item_status: ["pending", "assigned", "consumed"],
      job_type: ["install", "service"],
      user_role: ["admin", "installer"],
    },
  },
} as const
