export type OrganizationIdentity = {
  name: string;
  plan: string;
  description: string;
};

export type UserIdentity = {
  name: string;
  role: string;
};

export const defaultOrganization: OrganizationIdentity = {
  name: "Nafixhutao",
  plan: "Free",
  description: "Organization workspace",
};

export const defaultUser: UserIdentity = {
  name: "Nafi",
  role: "Member",
};

export function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();

  return `${words[0].slice(0, 1)}${words[words.length - 1].slice(0, 1)}`.toUpperCase();
}
