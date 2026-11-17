import { redirect } from "next/navigation";

/** The sign-in form lives at /login (and sign-up at /signup); root goes there. */
export default function Home() {
  redirect("/login");
}
