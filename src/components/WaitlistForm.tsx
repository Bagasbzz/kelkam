"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { CheckCircle2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const hasJoined = localStorage.getItem("thesis_flow_joined_waitlist");
    if (hasJoined) setStatus("success");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const { error } = await supabase.from("waitlist").insert([{ email }]);
      if (error && error.code !== "23505") throw error;
      localStorage.setItem("thesis_flow_joined_waitlist", "true");
      setStatus("success");
      setEmail("");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Terjadi kesalahan. Coba lagi.");
    }
  };

  if (status === "success") {
    return (
      <div className="w-full flex flex-col gap-4 animate-in slide-in-from-bottom duration-500">
        <div className="flex items-center gap-3 p-5 bg-green-50 border border-green-100 text-green-700 rounded-3xl">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <p className="font-bold text-sm">Email Anda sudah terdaftar di waitlist!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full items-end">
        <Input
          type="email"
          placeholder="Email universitas Anda..."
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          className="flex-1"
        />
        <Button
          type="submit"
          isLoading={status === "loading"}
          variant="dark"
          size="md"
          className="h-[60px] sm:w-auto w-full"
        >
          JOIN WAITLIST
        </Button>
      </form>
      {status === "error" && (
        <p className="text-red-500 text-[10px] font-black uppercase tracking-widest text-center">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
