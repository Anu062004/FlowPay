import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

export function generateSeedPhrase() {
  return generateMnemonic(wordlist);
}
