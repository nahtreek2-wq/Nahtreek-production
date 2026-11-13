import { BadRequestException } from "@nestjs/common";
import { AccountStatus, Role } from "@prisma/client";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  it("summarizes every verification state including empty states", async () => {
    const prisma = {
      professionalProfile: {
        groupBy: jest.fn().mockResolvedValue([
          { verificationStatus: "UNDER_REVIEW", _count: { _all: 3 } },
          { verificationStatus: "VERIFIED", _count: { _all: 7 } },
        ]),
      },
    };
    const result = await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).summary();
    expect(result).toMatchObject({ UNDER_REVIEW: 3, VERIFIED: 7, REJECTED: 0 });
  });

  it("blocks approval until every role-specific document is approved", async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      $transaction: (fn: any) => fn(prisma),
      professionalProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: "profile",
          userId: "professional",
          verificationStatus: "UNDER_REVIEW",
          user: { roles: [{ role: Role.ENGINEER }] },
          verificationDocuments: [
            { documentType: "identity-proof", status: "APPROVED" },
          ],
        }),
      },
    };
    await expect(
      new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).reviewProfile("profile", "admin", {
        status: "VERIFIED",
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("records a successful approval for both administrator and professional", async () => {
    const profile = {
      id: "profile",
      userId: "professional",
      verificationStatus: "UNDER_REVIEW",
      user: { roles: [{ role: Role.SERVICE_PROVIDER }] },
      verificationDocuments: [
        { documentType: "identity-proof", status: "APPROVED" },
        { documentType: "address-proof", status: "APPROVED" },
        { documentType: "work-sample", status: "APPROVED" },
      ],
    };
    const tx = {
      $queryRaw: jest.fn(),
      professionalProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({ verificationStatus: "VERIFIED" }),
      },
      notification: { create: jest.fn() },
      auditLog: { createMany: jest.fn() },
    };
    const prisma = {
      professionalProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const push = {dispatch: jest.fn().mockResolvedValue({})};
    const realtime = {emitUserUpdate: jest.fn()};
    await new AdminService(prisma as any, push as any, realtime as any).reviewProfile("profile", "admin", {
      status: "VERIFIED",
    });
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "professional" }),
      })
    );
    expect(tx.auditLog.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(push.dispatch).toHaveBeenCalledTimes(1);
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith("professional", "notifications");
  });

  it("does not let the verification desk modify a verified profile", async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      $transaction: (fn: any) => fn(prisma),
      professionalProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: "profile",
          userId: "professional",
          verificationStatus: "VERIFIED",
          user: { roles: [{ role: Role.ENGINEER }] },
          verificationDocuments: [],
        }),
      },
    };
    await expect(
      new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).reviewProfile("profile", "admin", {
        status: "REJECTED",
        reason: "Attempted review change",
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('hides a verified professional when a document is rejected', async () => {
    const tx = {$queryRaw: jest.fn(),
      verificationDocument: {findFirst: jest.fn().mockResolvedValue({profile: {userId: 'owner', verificationStatus: 'VERIFIED'}}), update: jest.fn()},
      professionalProfile: {update: jest.fn()}, providerPresence: {updateMany: jest.fn()}, notification: {create: jest.fn()}, auditLog: {create: jest.fn()}};
    const prisma = {$transaction: (fn: any) => fn(tx)};
    await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).reviewDocument('profile', 'document', 'admin', {status: 'REJECTED', reason: 'Document expired'});
    expect(tx.professionalProfile.update).toHaveBeenCalledWith({where: {id: 'profile'}, data: {verificationStatus: 'REJECTED', onboardingStep: 'REVIEW', isAvailable: false}});
    expect(tx.providerPresence.updateMany).toHaveBeenCalledWith({where: {professionalProfileId: 'profile'}, data: {online: false}});
    expect(tx.notification.create.mock.calls[0][0].data.userId).toBe('owner');
  });
  it('turns off work and live presence when a profile is rejected', async () => {
    const profile = {
      id: 'profile',
      userId: 'professional',
      verificationStatus: 'UNDER_REVIEW',
      user: {roles: [{role: Role.SERVICE_PROVIDER}]},
      verificationDocuments: [],
    };
    const tx = {
      $queryRaw: jest.fn(),
      professionalProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
        update: jest.fn(),
      },
      providerPresence: {updateMany: jest.fn()},
      notification: {create: jest.fn()},
      auditLog: {createMany: jest.fn()},
    };
    const prisma = {$transaction: (callback: (value: typeof tx) => unknown) => callback(tx)};
    await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).reviewProfile('profile', 'admin', {
      status: 'REJECTED',
      reason: 'Documents need correction',
    });
    expect(tx.professionalProfile.update).toHaveBeenCalledWith({
      where: {id: 'profile'},
      data: {verificationStatus: 'REJECTED', onboardingStep: 'REVIEW', isAvailable: false},
    });
    expect(tx.providerPresence.updateMany).toHaveBeenCalledWith({
      where: {professionalProfileId: 'profile'},
      data: {online: false},
    });
  });

  it("deactivates a non-admin user, revokes sessions and writes an audit event", async () => {
    const user = {
      id: "client-user",
      email: "client@example.test",
      phoneNumber: "+919000000001",
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      roles: [{ role: Role.CLIENT }],
      clientProfile: { fullName: "Client", avatarUrl: null, city: "Coimbatore", state: "Tamil Nadu" },
      professionalProfile: null,
      _count: { sessions: 0, notifications: 0 },
    };
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ ...user, status: AccountStatus.DEACTIVATED, deletedAt: new Date() }) },
      session: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const result = await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).changeUserStatus(
      "client-user",
      "admin-user",
      { status: AccountStatus.DEACTIVATED, reason: "Requested by operations" }
    );
    expect(result.status).toBe(AccountStatus.DEACTIVATED);
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "client-user" } });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it("does not allow the user console to modify another administrator", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "another-admin",
          status: AccountStatus.ACTIVE,
          roles: [{ role: Role.ADMIN }],
        }),
      },
    };
    await expect(
      new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).changeUserStatus(
        "another-admin",
        "admin-user",
        { status: AccountStatus.SUSPENDED, reason: "Invalid test" }
      )
    ).rejects.toThrow();
  });

  it("updates an administrator display name and records the change", async () => {
    const tx = {
      user: {
        update: jest.fn().mockResolvedValue({
          id: "admin-user",
          displayName: "Operations Lead",
          email: "admin@example.test",
          phoneNumber: "+919000000009",
          createdAt: new Date(),
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-user" }) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const result = await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).updateAdminProfile(
      "admin-user",
      { displayName: " Operations Lead " }
    );
    expect(result.displayName).toBe("Operations Lead");
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ADMIN_PROFILE_UPDATED" }) })
    );
  });

  it("updates editable client profile details without changing protected account fields", async () => {
    const user = {
      id: "client-user",
      displayName: null,
      email: "client@example.test",
      phoneNumber: "+919000000001",
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      roles: [{ role: Role.CLIENT }],
      clientProfile: { fullName: "Old Name", avatarUrl: null, city: "Old City", state: "Tamil Nadu" },
      professionalProfile: null,
      _count: { sessions: 1, notifications: 0 },
    };
    const updated = {
      ...user,
      clientProfile: { ...user.clientProfile, fullName: "New Name", city: "Coimbatore" },
    };
    const tx = {
      clientProfile: { update: jest.fn() },
      professionalProfile: { update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(updated) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(user) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const result = await new AdminService(prisma as any, {dispatch: jest.fn().mockResolvedValue({})} as any, {emitUserUpdate: jest.fn()} as any).updateUserDetails(
      "client-user",
      "admin-user",
      { fullName: "New Name", city: "Coimbatore", state: "Tamil Nadu" }
    );
    expect(result.fullName).toBe("New Name");
    expect(tx.clientProfile.update).toHaveBeenCalled();
    expect(tx.professionalProfile.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "USER_DETAILS_UPDATED" }) })
    );
  });
});
