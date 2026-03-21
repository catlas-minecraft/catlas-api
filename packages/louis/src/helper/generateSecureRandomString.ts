import { generateRandomString } from "@oslojs/crypto/random";

// 10-characters long string consisting of upper case letters
export const generateSecureRandomString = () => {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return generateRandomString(
    {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    },
    alphabet,
    24,
  );
};
