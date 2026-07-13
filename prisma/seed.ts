import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { PERMISSIONS } from "../src/modules/auth/services/permissions";
import { ROLE_SLUGS } from "../src/modules/auth/services/users";

const prisma = new PrismaClient();

async function main() {
  // Catálogo de permissões (Etapa 1, seção 03 — permissão por ação, não por perfil).
  const permissionSeeds = [
    { slug: PERMISSIONS.USERS_MANAGE, description: "Criar, editar e bloquear usuários" },
    { slug: PERMISSIONS.ROLES_MANAGE, description: "Gerenciar perfis e permissões" },
    { slug: PERMISSIONS.AUDIT_READ, description: "Consultar a trilha de auditoria" },
    { slug: PERMISSIONS.FINANCE_READ, description: "Ler módulos financeiros" },
    { slug: PERMISSIONS.SETTINGS_MANAGE, description: "Alterar configurações do sistema" },
    { slug: PERMISSIONS.CUSTOMERS_MANAGE, description: "Cadastrar e editar clientes" },
    { slug: PERMISSIONS.CRM_MANAGE, description: "Criar oportunidades e mover cards do Kanban CRM" },
  ];

  for (const p of permissionSeeds) {
    await prisma.permission.upsert({
      where: { slug: p.slug },
      update: { description: p.description },
      create: p,
    });
  }
  const allPermissions = await prisma.permission.findMany();

  const root = await prisma.role.upsert({
    where: { slug: ROLE_SLUGS.ROOT },
    update: {},
    create: { slug: ROLE_SLUGS.ROOT, name: "ROOT", description: "Acesso integral ao sistema" },
  });
  const admin = await prisma.role.upsert({
    where: { slug: ROLE_SLUGS.ADMIN },
    update: {},
    create: {
      slug: ROLE_SLUGS.ADMIN,
      name: "Administrador",
      description: "Acesso operacional a CRM, clientes, projetos, estoque e financeiro",
    },
  });
  const contador = await prisma.role.upsert({
    where: { slug: ROLE_SLUGS.CONTADOR },
    update: {},
    create: {
      slug: ROLE_SLUGS.CONTADOR,
      name: "Contador",
      description: "Somente leitura dos módulos financeiros",
    },
  });

  // ROOT tem acesso integral — recebe toda permissão que existir, sempre.
  await prisma.rolePermission.deleteMany({ where: { roleId: root.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({ roleId: root.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const adminSlugs = [
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.CRM_MANAGE,
  ];
  await prisma.rolePermission.deleteMany({ where: { roleId: admin.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions
      .filter((p) => (adminSlugs as string[]).includes(p.slug))
      .map((p) => ({ roleId: admin.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const contadorSlugs = [PERMISSIONS.FINANCE_READ];
  await prisma.rolePermission.deleteMany({ where: { roleId: contador.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions
      .filter((p) => (contadorSlugs as string[]).includes(p.slug))
      .map((p) => ({ roleId: contador.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  // Usuário ROOT inicial — obrigatório para o primeiro login existir.
  const rootEmail = (process.env.SEED_ROOT_EMAIL ?? "admin@ers3d.com.br").toLowerCase();
  const rootPassword = process.env.SEED_ROOT_PASSWORD ?? "troque-esta-senha-no-primeiro-login";

  const existingRootUser = await prisma.user.findUnique({ where: { email: rootEmail } });
  if (!existingRootUser) {
    const passwordHash = await argon2.hash(rootPassword);
    const user = await prisma.user.create({
      data: {
        name: "Administrador ERS 3D",
        email: rootEmail,
        passwordHash,
        userRoles: { create: { roleId: root.id } },
      },
    });
    console.log(`Usuário ROOT criado: ${user.email}`);
  } else {
    console.log(`Usuário ROOT já existe: ${existingRootUser.email}`);
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
