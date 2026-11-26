import { z } from "zod";

export const stayAwakeActionSchema = z.enum(["on", "off", "toggle", "status"]);
export type StayAwakeAction = z.infer<typeof stayAwakeActionSchema>;
