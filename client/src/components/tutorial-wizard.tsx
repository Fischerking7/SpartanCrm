import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { X, ChevronRight, ChevronLeft, BookOpen, CheckCircle } from "lucide-react";

// ============ TYPES ============

interface TutorialStep {
  titleEn: string;
  titleEs: string;
  descEn: string;
  descEs: string;
  area: string;
}

interface TutorialStatus {
  tutorialCompleted: boolean;
  tutorialEnabled: boolean;
}

// ============ TUTORIAL STEP DEFINITIONS (PER ROLE) ============

const TUTORIAL_STEPS: Record<string, TutorialStep[]> = {
  REP: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as a Sales Representative. You can skip at any time and re-enable this tutorial from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Representante de Ventas. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Your Dashboard",
      titleEs: "Tu Panel Principal",
      descEn: "Your dashboard shows your personal performance at a glance — sales volume, commission totals, and recent activity. Check it daily to stay on top of your numbers.",
      descEs: "Tu panel muestra tu rendimiento personal de un vistazo: volumen de ventas, comisiones totales y actividad reciente. Revísalo diariamente para mantenerte al día con tus cifras.",
      area: "Sales › Dashboard",
    },
    {
      titleEn: "Entering Orders",
      titleEs: "Ingresar Órdenes",
      descEn: "Use 'Quick Entry' to submit new sales orders from your phone or tablet. The Order Tracker shows you the live status of all your submitted orders.",
      descEs: "Usa 'Entrada Rápida' para enviar nuevas órdenes de venta desde tu teléfono o tableta. El Rastreador de Órdenes muestra el estado en tiempo real de todas tus órdenes enviadas.",
      area: "Sales › Quick Entry & Order Tracker",
    },
    {
      titleEn: "My Leads",
      titleEs: "Mis Prospectos",
      descEn: "Your assigned leads are listed here. Update dispositions after each contact attempt and track progress through the sales pipeline.",
      descEs: "Tus prospectos asignados aparecen aquí. Actualiza las disposiciones después de cada intento de contacto y sigue el progreso en el embudo de ventas.",
      area: "Sales › My Leads",
    },
    {
      titleEn: "Commissions & Pay History",
      titleEs: "Comisiones e Historial de Pagos",
      descEn: "View your earned commissions, forecast upcoming pay, and review your full pay history. Use the Earnings Simulator to model different sales scenarios.",
      descEs: "Ve tus comisiones ganadas, proyecta tus pagos futuros y revisa tu historial de pagos completo. Usa el Simulador de Ganancias para modelar diferentes escenarios de ventas.",
      area: "My Account › Commissions, Forecast, Pay History",
    },
    {
      titleEn: "Referrals & Follow-Ups",
      titleEs: "Referencias y Seguimientos",
      descEn: "Track your customer referrals and schedule follow-up calls to maximize your sales opportunities.",
      descEs: "Rastrea las referencias de tus clientes y programa llamadas de seguimiento para maximizar tus oportunidades de venta.",
      area: "Sales › Referrals & Follow-Ups",
    },
    {
      titleEn: "Alerts & Settings",
      titleEs: "Alertas y Configuración",
      descEn: "Use the Alerts section to see notifications about order approvals, chargebacks, and pay runs. You can customize which emails you receive in Alert Settings.",
      descEs: "Usa la sección de Alertas para ver notificaciones sobre aprobaciones de órdenes, contracargos y corridas de pago. Puedes personalizar qué correos recibes en Configuración de Alertas.",
      area: "Resources › Alerts & Alert Settings",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM. You can re-enable this tutorial anytime from Alert Settings. Good luck with your sales!",
      descEs: "Estás listo para usar Iron Crest CRM. Puedes volver a habilitar este tutorial en cualquier momento desde Configuración de Alertas. ¡Mucho éxito en tus ventas!",
      area: "Complete",
    },
  ],

  MDU: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as an MDU Representative. You can skip at any time and re-enable this tutorial from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Representante MDU. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "My MDU Orders",
      titleEs: "Mis Órdenes MDU",
      descEn: "The MDU Orders page is your primary workspace for managing multi-dwelling unit sales. Track the status of each MDU property you're working with.",
      descEs: "La página de Órdenes MDU es tu espacio de trabajo principal para gestionar ventas de unidades multifamiliares. Rastrea el estado de cada propiedad MDU con la que trabajas.",
      area: "Sales › My MDU Orders",
    },
    {
      titleEn: "Quick Entry & Order Tracker",
      titleEs: "Entrada Rápida y Rastreador de Órdenes",
      descEn: "Submit new orders quickly with Quick Entry, and monitor all your orders in real time using the Order Tracker.",
      descEs: "Envía nuevas órdenes rápidamente con Entrada Rápida y monitorea todas tus órdenes en tiempo real usando el Rastreador de Órdenes.",
      area: "Sales › Quick Entry & Order Tracker",
    },
    {
      titleEn: "Commissions & Pay History",
      titleEs: "Comisiones e Historial de Pagos",
      descEn: "View your earned commissions, forecast upcoming pay, and review your full pay history.",
      descEs: "Ve tus comisiones ganadas, proyecta tus pagos futuros y revisa tu historial de pagos completo.",
      area: "My Account › Commissions, Pay History",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM. You can re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM. Puedes volver a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  LEAD: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as a Team Lead. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Líder de Equipo. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Dashboard & Team Overview",
      titleEs: "Panel y Resumen del Equipo",
      descEn: "Your dashboard provides a snapshot of your team's activity — orders submitted, commissions generated, and performance metrics for your reps.",
      descEs: "Tu panel ofrece un resumen de la actividad de tu equipo: órdenes enviadas, comisiones generadas y métricas de rendimiento de tus representantes.",
      area: "Sales › Dashboard",
    },
    {
      titleEn: "Lead Pool & Pipeline",
      titleEs: "Grupo de Prospectos y Embudo",
      descEn: "The Lead Pool shows available leads you can distribute to your reps. Use the Pipeline Forecast to project future performance.",
      descEs: "El Grupo de Prospectos muestra los prospectos disponibles que puedes distribuir a tus representantes. Usa la Previsión del Embudo para proyectar el rendimiento futuro.",
      area: "Sales › Lead Pool & Pipeline Forecast",
    },
    {
      titleEn: "Coaching Scorecards",
      titleEs: "Tarjetas de Evaluación de Coaching",
      descEn: "Review individual rep scorecards to identify coaching opportunities. Track key sales behaviors and performance indicators.",
      descEs: "Revisa las tarjetas de evaluación individuales para identificar oportunidades de coaching. Rastrea comportamientos clave de ventas e indicadores de rendimiento.",
      area: "Sales › Coaching Scorecards",
    },
    {
      titleEn: "Adjustments & Commissions",
      titleEs: "Ajustes y Comisiones",
      descEn: "Submit commission adjustments for your team when needed. Review your own commissions and pay history in My Account.",
      descEs: "Envía ajustes de comisiones para tu equipo cuando sea necesario. Revisa tus propias comisiones e historial de pagos en Mi Cuenta.",
      area: "Sales › Adjustments | My Account › Commissions",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as a Team Lead. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como Líder de Equipo. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  MANAGER: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as a Manager. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Gerente. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Team Dashboard",
      titleEs: "Panel del Equipo",
      descEn: "Your dashboard shows aggregated team performance, including total connects, revenue, and commission summaries across all your leads and reps.",
      descEs: "Tu panel muestra el rendimiento agregado del equipo, incluidos conexiones totales, ingresos y resúmenes de comisiones de todos tus líderes y representantes.",
      area: "Sales › Dashboard",
    },
    {
      titleEn: "Pipeline Forecast & Lead Pool",
      titleEs: "Previsión del Embudo y Grupo de Prospectos",
      descEn: "Use the Pipeline Forecast to project team output over the coming weeks. The Lead Pool lets you manage lead distribution across your team.",
      descEs: "Usa la Previsión del Embudo para proyectar la producción del equipo en las próximas semanas. El Grupo de Prospectos te permite gestionar la distribución de prospectos en tu equipo.",
      area: "Sales › Pipeline Forecast & Lead Pool",
    },
    {
      titleEn: "Coaching Scorecards",
      titleEs: "Tarjetas de Evaluación de Coaching",
      descEn: "Drill into individual rep scorecards, track KPIs, and identify reps who need coaching or recognition.",
      descEs: "Profundiza en las tarjetas de evaluación individuales de representantes, rastrea KPIs e identifica representantes que necesitan coaching o reconocimiento.",
      area: "Sales › Coaching Scorecards",
    },
    {
      titleEn: "Reports & Analytics",
      titleEs: "Informes y Análisis",
      descEn: "Generate reports on team performance, sales trends, and commission data. Use Reports to drill down into specific periods or reps.",
      descEs: "Genera informes sobre el rendimiento del equipo, tendencias de ventas y datos de comisiones. Usa Informes para analizar períodos específicos o representantes.",
      area: "Sales › Reports",
    },
    {
      titleEn: "User Activity & Adjustments",
      titleEs: "Actividad de Usuarios y Ajustes",
      descEn: "Monitor rep login activity and field actions in User Activity. Submit commission adjustments when corrections are needed.",
      descEs: "Monitorea la actividad de inicio de sesión de los representantes y acciones en campo en Actividad de Usuarios. Envía ajustes de comisiones cuando se necesiten correcciones.",
      area: "Sales › User Activity & Adjustments",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as a Manager. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como Gerente. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  DIRECTOR: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as a Director. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Director. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Executive Reports & Analytics",
      titleEs: "Informes Ejecutivos y Análisis",
      descEn: "Access high-level executive reports covering organization-wide performance, revenue trends, and team comparisons.",
      descEs: "Accede a informes ejecutivos de alto nivel que cubren el rendimiento a nivel organizacional, tendencias de ingresos y comparaciones de equipos.",
      area: "Sales › Executive Reports",
    },
    {
      titleEn: "Pipeline Forecast & Lead Pool",
      titleEs: "Previsión del Embudo y Grupo de Prospectos",
      descEn: "View and manage the entire sales pipeline across all managers. Use Pipeline Forecast to project organization-level output.",
      descEs: "Ve y gestiona todo el embudo de ventas en todos los gerentes. Usa la Previsión del Embudo para proyectar la producción a nivel organizacional.",
      area: "Sales › Pipeline Forecast & Lead Pool",
    },
    {
      titleEn: "Override Approvals",
      titleEs: "Aprobaciones de Sobresueldo",
      descEn: "Review and approve commission override requests submitted by managers and leads. Ensure override agreements are properly authorized.",
      descEs: "Revisa y aprueba solicitudes de sobresueldos de comisión enviadas por gerentes y líderes. Asegúrate de que los acuerdos de sobresueldo estén correctamente autorizados.",
      area: "Sales › Override Approvals",
    },
    {
      titleEn: "Coaching Scorecards & User Activity",
      titleEs: "Tarjetas de Evaluación y Actividad de Usuarios",
      descEn: "Monitor team-wide coaching scorecards and track user activity across the organization.",
      descEs: "Monitorea las tarjetas de evaluación a nivel de equipo y rastrea la actividad de usuarios en toda la organización.",
      area: "Sales › Coaching Scorecards & User Activity",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as a Director. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como Director. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  EXECUTIVE: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as an Executive. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Ejecutivo. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Executive Dashboard & Reports",
      titleEs: "Panel Ejecutivo e Informes",
      descEn: "Your dashboard and Executive Reports provide organization-wide visibility into sales, commissions, and team performance at every level.",
      descEs: "Tu panel e Informes Ejecutivos brindan visibilidad a nivel organizacional sobre ventas, comisiones y rendimiento del equipo en todos los niveles.",
      area: "Sales › Dashboard & Executive Reports",
    },
    {
      titleEn: "Pay Runs & Financial Oversight",
      titleEs: "Corridas de Pago y Supervisión Financiera",
      descEn: "Initiate and oversee pay runs across the organization. Review export history and manage exception queues for unresolved commission items.",
      descEs: "Inicia y supervisa corridas de pago en toda la organización. Revisa el historial de exportaciones y gestiona colas de excepciones para elementos de comisión sin resolver.",
      area: "Sales › Pay Runs & Exception Queues",
    },
    {
      titleEn: "Users & Team Management",
      titleEs: "Usuarios y Gestión del Equipo",
      descEn: "Manage the organization's user base — create accounts, assign roles, and track activity across all reps, leads, and managers.",
      descEs: "Gestiona la base de usuarios de la organización: crea cuentas, asigna roles y rastrea la actividad de todos los representantes, líderes y gerentes.",
      area: "Sales › Users & User Activity",
    },
    {
      titleEn: "MDU Review & Adjustments",
      titleEs: "Revisión MDU y Ajustes",
      descEn: "Review MDU order submissions and approve or reject them. Submit commission adjustments for edge cases.",
      descEs: "Revisa los envíos de órdenes MDU y apruébalos o recházalos. Envía ajustes de comisiones para casos especiales.",
      area: "Sales › MDU Review & Adjustments",
    },
    {
      titleEn: "Audit Log",
      titleEs: "Registro de Auditoría",
      descEn: "The Audit Log records all significant actions across the platform — use it for compliance verification and to investigate any anomalies.",
      descEs: "El Registro de Auditoría registra todas las acciones significativas en la plataforma: úsalo para verificación de cumplimiento e investigar anomalías.",
      area: "Sales › Audit Log",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as an Executive. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como Ejecutivo. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  OPERATIONS: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as an Operations user. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como usuario de Operaciones. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "SLA & Bottlenecks Dashboard",
      titleEs: "Panel de SLA y Cuellos de Botella",
      descEn: "Monitor service level agreements and identify bottlenecks across the order pipeline. Spot delays before they impact commissions.",
      descEs: "Monitorea acuerdos de nivel de servicio e identifica cuellos de botella en el flujo de órdenes. Detecta retrasos antes de que afecten las comisiones.",
      area: "Operations › SLA & Bottlenecks",
    },
    {
      titleEn: "Onboarding Pipeline",
      titleEs: "Flujo de Incorporación",
      descEn: "Track new rep onboarding progress, identify stalled submissions, and ensure new hires complete all required documentation.",
      descEs: "Rastrea el progreso de incorporación de nuevos representantes, identifica envíos estancados y asegúrate de que los nuevos empleados completen toda la documentación requerida.",
      area: "Operations › Onboarding Pipeline",
    },
    {
      titleEn: "Exception Queues & Orders",
      titleEs: "Colas de Excepciones y Órdenes",
      descEn: "Review and resolve order exceptions and unmatched payments. Use the Queues page to prioritize by urgency.",
      descEs: "Revisa y resuelve excepciones de órdenes y pagos no emparejados. Usa la página de Colas para priorizar por urgencia.",
      area: "Operations › Exception Queues & Orders",
    },
    {
      titleEn: "System Settings & Automation",
      titleEs: "Configuración del Sistema y Automatización",
      descEn: "Configure automation rules for exception handling, manage system settings, and review automation rule performance.",
      descEs: "Configura reglas de automatización para el manejo de excepciones, gestiona la configuración del sistema y revisa el rendimiento de las reglas de automatización.",
      area: "Settings › Automation Rules",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as an Operations user. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como usuario de Operaciones. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  ACCOUNTING: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as an Accounting user. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como usuario de Contabilidad. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "Pay Runs",
      titleEs: "Corridas de Pago",
      descEn: "Initiate, review, and finalize pay runs. Pay runs calculate commissions for the specified period and generate pay statements for all active reps.",
      descEs: "Inicia, revisa y finaliza corridas de pago. Las corridas de pago calculan las comisiones para el período especificado y generan estados de cuenta para todos los representantes activos.",
      area: "Accounting › Pay Runs",
    },
    {
      titleEn: "Payment Variances",
      titleEs: "Variaciones de Pago",
      descEn: "Identify and resolve discrepancies between expected and actual carrier payments. Flag and investigate variances to ensure accurate bookkeeping.",
      descEs: "Identifica y resuelve discrepancias entre los pagos esperados y reales de los operadores. Marca e investiga las variaciones para garantizar una contabilidad precisa.",
      area: "Accounting › Payment Variances",
    },
    {
      titleEn: "Month-End Checklist",
      titleEs: "Lista de Verificación de Fin de Mes",
      descEn: "Use the Month-End Checklist to ensure all accounting tasks are completed before closing the period — reconciliations, exports, and approvals.",
      descEs: "Usa la Lista de Verificación de Fin de Mes para asegurarte de que todas las tareas contables se completen antes de cerrar el período: conciliaciones, exportaciones y aprobaciones.",
      area: "Accounting › Month-End Checklist",
    },
    {
      titleEn: "Cash Flow Forecast",
      titleEs: "Previsión de Flujo de Efectivo",
      descEn: "Project upcoming commission payout obligations and cash flow requirements based on current pipeline and historical trends.",
      descEs: "Proyecta las obligaciones de pago de comisiones futuras y los requisitos de flujo de efectivo basándote en el flujo de trabajo actual y tendencias históricas.",
      area: "Accounting › Cash Flow Forecast",
    },
    {
      titleEn: "Exception Queues & Accounting Tools",
      titleEs: "Colas de Excepciones y Herramientas Contables",
      descEn: "Resolve accounting exceptions, manage finance imports, and use the Recalculate tool to reprocess commissions when rate cards change.",
      descEs: "Resuelve excepciones contables, gestiona importaciones financieras y usa la herramienta de Recalcular para reprocesar comisiones cuando cambian las tarjetas de tarifas.",
      area: "Accounting › Exception Queues & Recalculate",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to use Iron Crest CRM as an Accounting user. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para usar Iron Crest CRM como usuario de Contabilidad. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],

  ADMIN: [
    {
      titleEn: "Welcome to Iron Crest CRM",
      titleEs: "Bienvenido a Iron Crest CRM",
      descEn: "This tutorial will walk you through the key features available to you as an Administrator. You can skip at any time and re-enable this from your Alert Settings.",
      descEs: "Este tutorial te guiará por las funciones clave disponibles como Administrador. Puedes omitirlo en cualquier momento y volver a habilitarlo desde tu Configuración de Alertas.",
      area: "Welcome",
    },
    {
      titleEn: "System Configuration",
      titleEs: "Configuración del Sistema",
      descEn: "As an Admin, you have full access to configure Providers, Clients, Services, Rate Cards, Incentives, and Override agreements. These settings drive commission calculations across the system.",
      descEs: "Como Administrador, tienes acceso completo para configurar Proveedores, Clientes, Servicios, Tarjetas de Tarifas, Incentivos y acuerdos de Sobresueldo. Estos ajustes impulsan los cálculos de comisiones en todo el sistema.",
      area: "Settings › Providers, Clients, Services, Rate Cards",
    },
    {
      titleEn: "User Management",
      titleEs: "Gestión de Usuarios",
      descEn: "Create and manage user accounts, assign roles and supervisors, reset passwords, and review employee credentials and onboarding submissions.",
      descEs: "Crea y gestiona cuentas de usuario, asigna roles y supervisores, restablece contraseñas y revisa las credenciales de empleados y envíos de incorporación.",
      area: "Settings › Users & Employee Credentials",
    },
    {
      titleEn: "Payroll & Pay Runs",
      titleEs: "Nómina y Corridas de Pago",
      descEn: "Manage payroll configuration, run pay calculations, finalize pay runs, and export data to QuickBooks. Use Advanced Payroll for complex scenarios.",
      descEs: "Gestiona la configuración de nómina, ejecuta cálculos de pago, finaliza corridas de pago y exporta datos a QuickBooks. Usa Nómina Avanzada para escenarios complejos.",
      area: "Settings › Payroll & QuickBooks",
    },
    {
      titleEn: "Accounting & Finance",
      titleEs: "Contabilidad y Finanzas",
      descEn: "Access the full accounting suite — finance imports, AR tracking, exception queues, adjustments, and audit logs.",
      descEs: "Accede a la suite completa de contabilidad: importaciones financieras, seguimiento de cuentas por cobrar, colas de excepciones, ajustes y registros de auditoría.",
      area: "Accounting section",
    },
    {
      titleEn: "Carrier & Install Sync",
      titleEs: "Sincronización de Operadores e Instalaciones",
      descEn: "Configure carrier profiles, rep mappings, and install sync runs to automatically match work orders to sales orders and credit commissions accordingly.",
      descEs: "Configura perfiles de operadores, mapeos de representantes y ejecuciones de sincronización de instalaciones para emparejar automáticamente las órdenes de trabajo con las órdenes de ventas y acreditar las comisiones correspondientes.",
      area: "Settings › Carrier Profiles & Install Sync",
    },
    {
      titleEn: "Automation Rules & Reports",
      titleEs: "Reglas de Automatización e Informes",
      descEn: "Set up automation rules to handle exception processing, and save report configurations for recurring use.",
      descEs: "Configura reglas de automatización para manejar el procesamiento de excepciones y guarda configuraciones de informes para uso recurrente.",
      area: "Settings › Automation Rules & Saved Reports",
    },
    {
      titleEn: "You're All Set!",
      titleEs: "¡Todo Listo!",
      descEn: "You're ready to administer Iron Crest CRM. Re-enable this tutorial anytime from Alert Settings.",
      descEs: "Estás listo para administrar Iron Crest CRM. Vuelve a habilitar este tutorial en cualquier momento desde Configuración de Alertas.",
      area: "Complete",
    },
  ],
};

// Fallback for any role not explicitly defined
function getStepsForRole(role: string): TutorialStep[] {
  return TUTORIAL_STEPS[role] ?? TUTORIAL_STEPS["REP"];
}

// ============ LANGUAGE DETECTION ============

function useLanguage(): "en" | "es" {
  const lang = navigator.language || "en";
  return lang.toLowerCase().startsWith("es") ? "es" : "en";
}

// ============ MAIN COMPONENT ============

export function TutorialWizard() {
  const { user } = useAuth();
  const lang = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);

  const { data: tutorialStatus, isLoading } = useQuery<TutorialStatus>({
    queryKey: ["/api/tutorial/status"],
    queryFn: async () => {
      const res = await fetch("/api/tutorial/status", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tutorial/complete", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tutorial/status"] });
      setVisible(false);
    },
  });

  useEffect(() => {
    if (!isLoading && tutorialStatus) {
      const shouldShow = !tutorialStatus.tutorialCompleted && tutorialStatus.tutorialEnabled;
      setVisible(shouldShow);
      setCurrentStep(0);
    }
  }, [tutorialStatus, isLoading]);

  if (!user || !visible || isLoading) return null;

  const steps = getStepsForRole(user.role);
  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const progress = ((currentStep + 1) / steps.length) * 100;

  const title = lang === "es" ? step.titleEs : step.titleEn;
  const desc = lang === "es" ? step.descEs : step.descEn;

  const handleNext = () => {
    if (isLast) {
      completeMutation.mutate();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleSkip = () => {
    completeMutation.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-4 bg-black/50 backdrop-blur-sm"
      data-testid="tutorial-wizard-overlay"
    >
      <Card className="w-full max-w-lg shadow-2xl border-0 ring-1 ring-border" data-testid="tutorial-wizard-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-base leading-snug" data-testid="tutorial-step-title">
                  {title}
                </CardTitle>
                {step.area !== "Welcome" && step.area !== "Complete" && (
                  <Badge variant="secondary" className="mt-1 text-xs font-normal" data-testid="tutorial-step-area">
                    {step.area}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground -mt-0.5 -mr-1"
              onClick={handleSkip}
              disabled={completeMutation.isPending}
              data-testid="button-tutorial-skip"
              title={lang === "es" ? "Omitir tutorial" : "Skip tutorial"}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="tutorial-step-description">
            {desc}
          </p>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span data-testid="tutorial-step-counter">
                {lang === "es" ? `Paso ${currentStep + 1} de ${steps.length}` : `Step ${currentStep + 1} of ${steps.length}`}
              </span>
              {isLast && (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-3 w-3" />
                  {lang === "es" ? "Completado" : "Complete"}
                </span>
              )}
            </div>
            <Progress value={progress} className="h-1.5" data-testid="tutorial-progress" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              disabled={completeMutation.isPending}
              className="text-muted-foreground text-xs"
              data-testid="button-tutorial-skip-bottom"
            >
              {lang === "es" ? "Omitir tutorial" : "Skip tutorial"}
            </Button>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  disabled={completeMutation.isPending}
                  data-testid="button-tutorial-back"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {lang === "es" ? "Anterior" : "Back"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleNext}
                disabled={completeMutation.isPending}
                data-testid="button-tutorial-next"
              >
                {isLast
                  ? (lang === "es" ? "Comenzar" : "Get Started")
                  : (
                    <>
                      {lang === "es" ? "Siguiente" : "Next"}
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
