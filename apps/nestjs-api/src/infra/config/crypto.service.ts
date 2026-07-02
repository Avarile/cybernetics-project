import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { deriveFernetKey, fernetDecrypt, fernetEncrypt } from "./fernet";

/**
 * Fernet encryption using the key derived from the shared Django SECRET_KEY. Byte-compatible with
 * plane/license/utils/encryption.py, so values Django wrote to InstanceConfiguration decrypt here.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private fernetKey!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secret = this.config.get<string>("SECRET_KEY");
    // Hard deployment dependency: SECRET_KEY must match Django (sessions + Fernet). Fail fast.
    if (!secret) throw new Error("SECRET_KEY is required and must match the Django backend.");
    this.fernetKey = deriveFernetKey(secret);
  }

  decrypt(token: string | null | undefined): string {
    if (!token) return "";
    return fernetDecrypt(this.fernetKey, token);
  }

  encrypt(plaintext: string): string {
    return fernetEncrypt(this.fernetKey, plaintext);
  }
}
