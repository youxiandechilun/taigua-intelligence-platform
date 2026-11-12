/*
 * 中文导读：共享基础能力：index.d.ts。相关类型、配置或辅助实现集中在本文件。
 */
export {};

declare global {

    interface Member {
        id: string;
        organizationId: string;
        role: "admin" | "member" | "owner";
        createdAt: Date;
        userId: string;
        user: {
            id: string;
            email: string;
            name: string;
            image?: string;
        };
    }

    interface Organization {
        id: string;
        name: string;
        slug: string;
        createdAt: Date;
        members: Member[];
        invitations: unknown[];
    }

}
