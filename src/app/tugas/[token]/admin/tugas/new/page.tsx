"use client";

import { useParams } from "next/navigation";
import TugasFormPage from "@/components/tugas/TugasFormPage";

export default function NewTugasPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  return <TugasFormPage token={token} />;
}