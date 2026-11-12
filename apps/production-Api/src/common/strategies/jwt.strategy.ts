import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AccountStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  phoneNumber: string;
  roles: string[];
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET as string,
      issuer: "nahtreek-api",
      audience: "nahtreek-mobile",
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: AccountStatus.ACTIVE, deletedAt: null },
      },
      include: { user: { include: { roles: true } } },
    });
    if (!session)
      throw new UnauthorizedException("Session is no longer active");
    if (session.authVersion !== session.user.authVersion)
      throw new UnauthorizedException("Session revoked. Please sign in again");
    return {
      ...payload,
      roles: session.user.roles.map(({ role }) => role),
    };
  }
}
