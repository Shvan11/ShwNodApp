/**
 * The 'Clinic' pseudo-doctor: the employee row that X-ray/Consult intake works are
 * stamped with (seeded by migration 1789460500000_seed-product-constants.sql).
 *
 * The code finds it BY NAME (`PatientService.resolveClinicDoctorId`), and
 * `employees.employee_name` is citext, so every match is case-insensitive. It is a
 * bucket, not a person: the works card shows it as "Clinic", never "Dr. Clinic"
 * (audit FE-F7-12), and the booking form floats it to the top of its doctor list.
 */
export const CLINIC_DOCTOR_NAME = 'Clinic';

export function isClinicDoctorName(name: string | null | undefined): boolean {
  return name != null && name.toLowerCase() === CLINIC_DOCTOR_NAME.toLowerCase();
}
