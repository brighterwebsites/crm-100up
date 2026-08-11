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
      assumptions: {
        Row: {
          created_at: string
          deye_standby_w: number
          id: number
          load_profile: Json
          sig_standby_w: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          deye_standby_w?: number
          id?: number
          load_profile?: Json
          sig_standby_w?: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          deye_standby_w?: number
          id?: number
          load_profile?: Json
          sig_standby_w?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      battery_rebate_tiers: {
        Row: {
          from_kwh: number
          id: number
          sort_order: number
          stc_per_kwh: number
          to_kwh: number | null
        }
        Insert: {
          from_kwh: number
          id?: number
          sort_order?: number
          stc_per_kwh: number
          to_kwh?: number | null
        }
        Update: {
          from_kwh?: number
          id?: number
          sort_order?: number
          stc_per_kwh?: number
          to_kwh?: number | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string
          contact_method: string
          created_at: string
          email: string
          id: number
          name: string
          phone: string
          updated_at: string
          version: number
        }
        Insert: {
          address?: string
          contact_method?: string
          created_at?: string
          email?: string
          id?: number
          name: string
          phone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string
          contact_method?: string
          created_at?: string
          email?: string
          id?: number
          name?: string
          phone?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      fixed_site_costs: {
        Row: {
          active: boolean
          amount: number
          id: number
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          amount?: number
          id?: number
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          amount?: number
          id?: number
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      ground_mount_settings: {
        Row: {
          ballpark_frame_per_panel: number
          id: number
          labour_per_panel: number
          machinery_fixed: number
          updated_at: string
          version: number
        }
        Insert: {
          ballpark_frame_per_panel?: number
          id?: number
          labour_per_panel?: number
          machinery_fixed?: number
          updated_at?: string
          version?: number
        }
        Update: {
          ballpark_frame_per_panel?: number
          id?: number
          labour_per_panel?: number
          machinery_fixed?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      installation_requests: {
        Row: {
          additional_notes: string
          created_at: string
          custom_items: Json
          issued_date: string | null
          job_id: number
          job_order_ref: string
          site_access_notes: string
          special_instructions: string
          updated_at: string
          vehicle: string
          version: number
        }
        Insert: {
          additional_notes?: string
          created_at?: string
          custom_items?: Json
          issued_date?: string | null
          job_id: number
          job_order_ref?: string
          site_access_notes?: string
          special_instructions?: string
          updated_at?: string
          vehicle?: string
          version?: number
        }
        Update: {
          additional_notes?: string
          created_at?: string
          custom_items?: Json
          issued_date?: string | null
          job_id?: number
          job_order_ref?: string
          site_access_notes?: string
          special_instructions?: string
          updated_at?: string
          vehicle?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "installation_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
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
          created_at: string
          customer_id: number
          fixes_needed: boolean
          id: number
          install_completion_date: string | null
          install_start_date: string | null
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          notes: string
          planned_install_date: string | null
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
          created_at?: string
          customer_id: number
          fixes_needed?: boolean
          id?: number
          install_completion_date?: string | null
          install_start_date?: string | null
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string
          notes?: string
          planned_install_date?: string | null
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
          created_at?: string
          customer_id?: number
          fixes_needed?: boolean
          id?: number
          install_completion_date?: string | null
          install_start_date?: string | null
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string
          notes?: string
          planned_install_date?: string | null
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
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
      manufacturers: {
        Row: {
          active: boolean
          brand: string
          cec_verified: boolean
          created_at: string
          id: number
          legal_name: string
        }
        Insert: {
          active?: boolean
          brand: string
          cec_verified?: boolean
          created_at?: string
          id?: number
          legal_name?: string
        }
        Update: {
          active?: boolean
          brand?: string
          cec_verified?: boolean
          created_at?: string
          id?: number
          legal_name?: string
        }
        Relationships: []
      }
      panel_settings: {
        Row: {
          id: number
          install_cost_per_w: number
          roof_frame_per_panel: number
          stock_id: number | null
          updated_at: string
          version: number
        }
        Insert: {
          id?: number
          install_cost_per_w?: number
          roof_frame_per_panel?: number
          stock_id?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          id?: number
          install_cost_per_w?: number
          roof_frame_per_panel?: number
          stock_id?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "panel_settings_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
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
      pricing_settings: {
        Row: {
          gst: number
          id: number
          margin: number
          updated_at: string
          version: number
        }
        Insert: {
          gst?: number
          id?: number
          margin?: number
          updated_at?: string
          version?: number
        }
        Update: {
          gst?: number
          id?: number
          margin?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          notification_email: string | null
          notification_phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          notification_email?: string | null
          notification_phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          notification_email?: string | null
          notification_phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          cost: number
          created_at: string
          id: number
          purchase_order_id: number
          qty_ordered: number
          qty_received: number
          stock_id: number
        }
        Insert: {
          cost?: number
          created_at?: string
          id?: number
          purchase_order_id: number
          qty_ordered: number
          qty_received?: number
          stock_id: number
        }
        Update: {
          cost?: number
          created_at?: string
          id?: number
          purchase_order_id?: number
          qty_ordered?: number
          qty_received?: number
          stock_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          id: number
          invoice_ref: string
          item_count: number
          occurred_at: string
          po_amount: number
          po_ref: string
          po_status: Database["public"]["Enums"]["po_status"]
          supplier_id: number | null
          total_units: number
        }
        Insert: {
          created_at?: string
          id?: number
          invoice_ref?: string
          item_count?: number
          occurred_at?: string
          po_amount?: number
          po_ref?: string
          po_status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: number | null
          total_units?: number
        }
        Update: {
          created_at?: string
          id?: number
          invoice_ref?: string
          item_count?: number
          occurred_at?: string
          po_amount?: number
          po_ref?: string
          po_status?: Database["public"]["Enums"]["po_status"]
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
      rebate_settings: {
        Row: {
          battery_stc_price: number
          id: number
          solar_stc_per_kw: number
          solar_stc_price: number
          updated_at: string
          version: number
        }
        Insert: {
          battery_stc_price?: number
          id?: number
          solar_stc_per_kw?: number
          solar_stc_price?: number
          updated_at?: string
          version?: number
        }
        Update: {
          battery_stc_price?: number
          id?: number
          solar_stc_per_kw?: number
          solar_stc_price?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      sizing_rules: {
        Row: {
          id: number
          max_batteries_per_inverter: number
          min_inverters: number
          solar_oversize_3ph_percent: number
          solar_oversize_percent: number
          updated_at: string
          version: number
        }
        Insert: {
          id?: number
          max_batteries_per_inverter?: number
          min_inverters?: number
          solar_oversize_3ph_percent?: number
          solar_oversize_percent?: number
          updated_at?: string
          version?: number
        }
        Update: {
          id?: number
          max_batteries_per_inverter?: number
          min_inverters?: number
          solar_oversize_3ph_percent?: number
          solar_oversize_percent?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      stocks: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["ces_category"]
          id: number
          kva: number | null
          kw: number | null
          kwh: number | null
          last_cost: number
          manufacturer_id: number | null
          model: string
          name: string
          phase: Database["public"]["Enums"]["electrical_phase"]
          planning_cost: number
          planning_cost_updated_at: string | null
          preferred_supplier_id: number | null
          product_type: Database["public"]["Enums"]["product_type"]
          qty: number
          usable_kwh: number | null
          verified: boolean
          watts: number | null
        }
        Insert: {
          active?: boolean
          category?: Database["public"]["Enums"]["ces_category"]
          id?: number
          kva?: number | null
          kw?: number | null
          kwh?: number | null
          last_cost?: number
          manufacturer_id?: number | null
          model?: string
          name: string
          phase?: Database["public"]["Enums"]["electrical_phase"]
          planning_cost?: number
          planning_cost_updated_at?: string | null
          preferred_supplier_id?: number | null
          product_type?: Database["public"]["Enums"]["product_type"]
          qty?: number
          usable_kwh?: number | null
          verified?: boolean
          watts?: number | null
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["ces_category"]
          id?: number
          kva?: number | null
          kw?: number | null
          kwh?: number | null
          last_cost?: number
          manufacturer_id?: number | null
          model?: string
          name?: string
          phase?: Database["public"]["Enums"]["electrical_phase"]
          planning_cost?: number
          planning_cost_updated_at?: string | null
          preferred_supplier_id?: number | null
          product_type?: Database["public"]["Enums"]["product_type"]
          qty?: number
          usable_kwh?: number | null
          verified?: boolean
          watts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stocks_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocks_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
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
      system_config_batteries: {
        Row: {
          config_id: number
          id: number
          is_default: boolean
          stock_id: number
        }
        Insert: {
          config_id: number
          id?: number
          is_default?: boolean
          stock_id: number
        }
        Update: {
          config_id?: number
          id?: number
          is_default?: boolean
          stock_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_config_batteries_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "system_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_config_batteries_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config_components: {
        Row: {
          config_id: number
          divisor: number
          id: number
          phase_scope: Database["public"]["Enums"]["electrical_phase"]
          qty: number
          rule: Database["public"]["Enums"]["qty_rule"]
          sort_order: number
          stock_id: number
        }
        Insert: {
          config_id: number
          divisor?: number
          id?: number
          phase_scope?: Database["public"]["Enums"]["electrical_phase"]
          qty?: number
          rule?: Database["public"]["Enums"]["qty_rule"]
          sort_order?: number
          stock_id: number
        }
        Update: {
          config_id?: number
          divisor?: number
          id?: number
          phase_scope?: Database["public"]["Enums"]["electrical_phase"]
          qty?: number
          rule?: Database["public"]["Enums"]["qty_rule"]
          sort_order?: number
          stock_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_config_components_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "system_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_config_components_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config_inverters: {
        Row: {
          config_id: number
          id: number
          max_batteries: number | null
          oversize_percent: number | null
          size_class: Database["public"]["Enums"]["inverter_size_class"] | null
          sort_order: number
          stock_id: number
        }
        Insert: {
          config_id: number
          id?: number
          max_batteries?: number | null
          oversize_percent?: number | null
          size_class?: Database["public"]["Enums"]["inverter_size_class"] | null
          sort_order?: number
          stock_id: number
        }
        Update: {
          config_id?: number
          id?: number
          max_batteries?: number | null
          oversize_percent?: number | null
          size_class?: Database["public"]["Enums"]["inverter_size_class"] | null
          sort_order?: number
          stock_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_config_inverters_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "system_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_config_inverters_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      system_configs: {
        Row: {
          active: boolean
          brand_filter: string
          id: number
          label: string
          sort_order: number
          standby_w: number
        }
        Insert: {
          active?: boolean
          brand_filter?: string
          id?: number
          label: string
          sort_order?: number
          standby_w?: number
        }
        Update: {
          active?: boolean
          brand_filter?: string
          id?: number
          label?: string
          sort_order?: number
          standby_w?: number
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
        Returns: {
          assigned_installer_id: string | null
          ces_received: string | null
          ces_submitted: string | null
          created_at: string
          customer_id: number
          fixes_needed: boolean
          id: number
          install_completion_date: string | null
          install_start_date: string | null
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          notes: string
          planned_install_date: string | null
          rebate_received: string | null
          rebate_submitted: string | null
          stage: number
          step: number
          system_description: string
          updated_at: string
          value: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_pending_bom_now: { Args: { p_job_id: number }; Returns: number }
      create_purchase_order: {
        Args: { p_lines: Json; p_supplier_id: number }
        Returns: {
          created_at: string
          id: number
          invoice_ref: string
          item_count: number
          occurred_at: string
          po_amount: number
          po_ref: string
          po_status: Database["public"]["Enums"]["po_status"]
          supplier_id: number | null
          total_units: number
        }
        SetofOptions: {
          from: "*"
          to: "purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_job_back: {
        Args: { p_expected_version: number; p_job_id: number }
        Returns: {
          assigned_installer_id: string | null
          ces_received: string | null
          ces_submitted: string | null
          created_at: string
          customer_id: number
          fixes_needed: boolean
          id: number
          install_completion_date: string | null
          install_start_date: string | null
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          notes: string
          planned_install_date: string | null
          rebate_received: string | null
          rebate_submitted: string | null
          stage: number
          step: number
          system_description: string
          updated_at: string
          value: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_stock: {
        Args: {
          p_invoice_ref: string
          p_lines: Json
          p_occurred_at: string
          p_supplier_id: number
        }
        Returns: {
          created_at: string
          id: number
          invoice_ref: string
          item_count: number
          occurred_at: string
          po_amount: number
          po_ref: string
          po_status: Database["public"]["Enums"]["po_status"]
          supplier_id: number | null
          total_units: number
        }
        SetofOptions: {
          from: "*"
          to: "purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_booking: {
        Args: {
          p_expected_version: number
          p_job_id: number
          p_new_date: string
        }
        Returns: {
          assigned_installer_id: string | null
          ces_received: string | null
          ces_submitted: string | null
          created_at: string
          customer_id: number
          fixes_needed: boolean
          id: number
          install_completion_date: string | null
          install_start_date: string | null
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          notes: string
          planned_install_date: string | null
          rebate_received: string | null
          rebate_submitted: string | null
          stage: number
          step: number
          system_description: string
          updated_at: string
          value: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      ces_category: "battery" | "inverter" | "panel" | "other"
      electrical_phase: "single" | "three" | "na"
      inverter_size_class: "small" | "medium" | "large"
      job_stock_item_status: "pending" | "assigned" | "consumed"
      job_type: "install" | "service"
      po_status: "sent" | "partially_received" | "closed"
      product_type:
        | "panel"
        | "inverter"
        | "battery"
        | "gateway"
        | "mounting"
        | "bms"
        | "gm_component"
        | "consumable"
        | "other"
      qty_rule:
        | "per_system"
        | "per_inverter"
        | "per_n_inverters"
        | "per_battery"
        | "per_n_batteries"
        | "per_panel"
        | "per_kw_solar"
      user_role: "admin" | "installer"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      ces_category: ["battery", "inverter", "panel", "other"],
      electrical_phase: ["single", "three", "na"],
      inverter_size_class: ["small", "medium", "large"],
      job_stock_item_status: ["pending", "assigned", "consumed"],
      job_type: ["install", "service"],
      po_status: ["sent", "partially_received", "closed"],
      product_type: [
        "panel",
        "inverter",
        "battery",
        "gateway",
        "mounting",
        "bms",
        "gm_component",
        "consumable",
        "other",
      ],
      qty_rule: [
        "per_system",
        "per_inverter",
        "per_n_inverters",
        "per_battery",
        "per_n_batteries",
        "per_panel",
        "per_kw_solar",
      ],
      user_role: ["admin", "installer"],
    },
  },
} as const
