import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

// Volunteer applications: every write goes through RPCs (privacy notice checked there); RLS limits reads to the
// applicant and the branch's Branch Manager / the region's Regional Director. National Coordinators get counts only.
export const APPLICATION_LIMITS = {
  helpMin: 30,
  helpMax: 500,
  skills: 500,
  phone: 40,
  declineMin: 10,
} as const;

/** "How much time can you give?" (the database accepts exactly these). */
export const TIME_COMMITMENTS = ["few_hours_month", "few_hours_week", "more"] as const;
export type TimeCommitment = (typeof TIME_COMMITMENTS)[number];

/** The answers every new application gives, at sign-up or later (check_volunteer_answers in the database). */
export type VolunteerAnswers = { help: string; time: TimeCommitment | ""; commitment: boolean };
export type VolunteerAnswerErrors = Partial<Record<keyof VolunteerAnswers, string>>;
export const EMPTY_ANSWERS: VolunteerAnswers = { help: "", time: "", commitment: false };

/** Field errors (i18n keys) before submitting; the database checks the same rules. */
export function validateVolunteerAnswers(a: VolunteerAnswers): VolunteerAnswerErrors {
  const errors: VolunteerAnswerErrors = {};
  const help = a.help.trim().length;
  if (help < APPLICATION_LIMITS.helpMin || help > APPLICATION_LIMITS.helpMax)
    errors.help = "applications.errors.help";
  if (!(TIME_COMMITMENTS as readonly string[]).includes(a.time))
    errors.time = "applications.errors.time";
  if (!a.commitment) errors.commitment = "applications.errors.commitment";
  return errors;
}

/** The sign-up metadata for the volunteer choice (handle_new_user creates the application). */
export const signUpApplication = (a: VolunteerAnswers) => ({
  help: a.help.trim(),
  time: a.time,
  commitment: true,
});

export const applicationStatus = z.enum(["submitted", "approved", "declined", "withdrawn"]);
export type ApplicationStatus = z.infer<typeof applicationStatus>;
const base = {
  id: z.string().uuid(),
  branch_id: z.string().uuid(),
  branch: z.string(),
  status: applicationStatus,
  motivation: z.string(),
  availability: z.string().nullable(),
  time_commitment: z.string().nullable().optional(),
  commitment_accepted_at: z.string().nullable().optional(),
  skills: z.string().nullable(),
  phone: z.string().nullable(),
  decline_reason: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
};
export const myApplication = z.object(base);
export type MyApplication = z.infer<typeof myApplication>;
export const reviewApplication = z.object({
  ...base,
  applicant_id: z.string().uuid().nullable(),
  applicant_name: z.string(),
  applicant_email: z.string().nullable(),
  reviewer_name: z.string().nullable(),
});
export type ReviewApplication = z.infer<typeof reviewApplication>;

export type ApplicationInput = VolunteerAnswers & {
  branch_id: string;
  skills: string;
  phone: string;
};

/** Field errors (i18n keys) of the "Become a Dialogue Society volunteer" form. */
export function validateApplication(input: ApplicationInput) {
  const errors: Partial<Record<keyof ApplicationInput, string>> = validateVolunteerAnswers(input);
  if (!input.branch_id) errors.branch_id = "applications.errors.branch";
  if (input.skills.length > APPLICATION_LIMITS.skills)
    errors.skills = "applications.errors.tooLong";
  if (input.phone.length > APPLICATION_LIMITS.phone) errors.phone = "applications.errors.tooLong";
  return errors;
}

async function rpc<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export const fetchMyApplications = async () =>
  z.array(myApplication).parse(await rpc(supabase.rpc("list_my_volunteer_applications")));
export const fetchApplicationsToReview = async (filter: "open" | "decided") =>
  z
    .array(reviewApplication)
    .parse(await rpc(supabase.rpc("list_volunteer_applications", { p_filter: filter })));
export const submitApplication = (input: ApplicationInput) =>
  rpc(
    supabase.rpc("submit_volunteer_application", {
      p: {
        branch_id: input.branch_id,
        motivation: input.help.trim(),
        time_commitment: input.time,
        commitment: input.commitment,
        skills: input.skills,
        phone: input.phone,
      },
    }),
  );
export const withdrawApplication = (id: string) =>
  rpc(supabase.rpc("withdraw_volunteer_application", { p_id: id }));
export const approveApplication = (id: string) =>
  rpc(supabase.rpc("approve_volunteer_application", { p_id: id }));
export const declineApplication = (id: string, reason: string) =>
  rpc(supabase.rpc("decline_volunteer_application", { p_id: id, p_reason: reason }));
export const deleteApplication = (id: string) =>
  rpc(supabase.rpc("delete_volunteer_application", { p_id: id }));

export function useMyApplications(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["my-volunteer-applications", userId],
    queryFn: fetchMyApplications,
    enabled: enabled && !!userId,
  });
}
export function useApplicationsToReview(
  userId: string | undefined,
  filter: "open" | "decided",
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["volunteer-applications", userId, filter],
    queryFn: () => fetchApplicationsToReview(filter),
    enabled: enabled && !!userId,
  });
}
