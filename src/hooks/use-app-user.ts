import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, TravelPolicy } from "@/lib/policy";
import { primaryRole } from "@/lib/policy";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  department: string | null;
  manager_id: string | null;
}

export interface AppUser {
  userId: string;
  email: string;
  profile: Profile | null;
  roles: AppRole[];
  policy: TravelPolicy | null;
}

export function useAppUser() {
  return useQuery<AppUser | null>({
    queryKey: ["app-user"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) return null;

      const [{ data: profile }, { data: roleRows }, { data: policies }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, full_name, department, manager_id")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("travel_policies").select("*"),
      ]);

      const roles = ((roleRows ?? []).map((r) => r.role) as AppRole[]) ?? [];
      const mine = primaryRole(roles);
      const policy =
        ((policies ?? []) as TravelPolicy[]).find((p) => p.role === mine) ?? null;

      return {
        userId: user.id,
        email: user.email ?? "",
        profile: (profile as Profile | null) ?? null,
        roles,
        policy,
      };
    },
  });
}

export function useTeamProfiles() {
  return useQuery<Profile[]>({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, department, manager_id")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}
