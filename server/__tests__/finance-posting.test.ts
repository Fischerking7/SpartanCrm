import { describe, it, expect, vi } from 'vitest';
import { executeFinanceImportPost, evaluateVarianceExceptions, type PostingStorage, type ArRow, type VarianceExceptionDeps } from '../finance-posting';

function createMockStorage(overrides: Partial<PostingStorage> = {}): PostingStorage {
  return {
    getFinanceImportRows: vi.fn().mockResolvedValue([]),
    getOrderById: vi.fn().mockResolvedValue(null),
    setOrderClientAcceptance: vi.fn().mockResolvedValue({}),
    getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
    getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue([]),
    createArExpectation: vi.fn().mockResolvedValue({ id: 'ar-1' }),
    updateOrder: vi.fn().mockResolvedValue({}),
    setPayrollReady: vi.fn().mockResolvedValue({}),
    updateFinanceImport: vi.fn().mockResolvedValue({}),
    createAuditLog: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeRow(opts: {
  id?: string;
  matchedOrderId: string;
  clientStatus?: string;
  paidAmountCents?: number;
  saleDate?: string;
  isDuplicate?: boolean;
  matchStatus?: string;
}) {
  return {
    id: opts.id || `row-${Math.random().toString(36).slice(2, 8)}`,
    matchedOrderId: opts.matchedOrderId,
    clientStatus: opts.clientStatus ?? 'ENROLLED',
    paidAmountCents: opts.paidAmountCents ?? 0,
    saleDate: opts.saleDate ?? '2025-01-15',
    isDuplicate: opts.isDuplicate ?? false,
    matchStatus: opts.matchStatus ?? 'MATCHED',
  };
}

function makeOrder(opts: {
  id?: string;
  baseCommissionEarned?: string;
  incentiveEarned?: string;
  overrideDeduction?: string;
  tvSold?: boolean;
  mobileSold?: boolean;
  installDate?: string;
  tvInstallDate?: string;
  mobileInstallDate?: string;
  jobStatus?: string;
  approvalStatus?: string;
  isPayrollHeld?: boolean;
  payrollReadyAt?: Date | null;
} = {}) {
  return {
    id: opts.id ?? 'order-1',
    baseCommissionEarned: opts.baseCommissionEarned ?? '100.00',
    incentiveEarned: opts.incentiveEarned ?? '0',
    overrideDeduction: opts.overrideDeduction ?? '0',
    tvSold: opts.tvSold ?? false,
    mobileSold: opts.mobileSold ?? false,
    installDate: opts.installDate ?? '2025-01-10',
    tvInstallDate: opts.tvInstallDate ?? null,
    mobileInstallDate: opts.mobileInstallDate ?? null,
    jobStatus: opts.jobStatus ?? 'PENDING',
    approvalStatus: opts.approvalStatus ?? 'PENDING',
    isPayrollHeld: opts.isPayrollHeld ?? false,
    payrollReadyAt: opts.payrollReadyAt ?? null,
  };
}

const IMPORT_ID = 'import-1';
const FINANCE_IMPORT = { clientId: 'client-1' };
const USER_ID = 'user-1';

describe('executeFinanceImportPost', () => {
  describe('simple order path (no multi-service)', () => {
    describe('without amounts (totalPaidCents=0)', () => {
      it('creates SATISFIED AR and marks order PAID', async () => {
        const order = makeOrder();
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(result.arCreated).toBe(1);
        expect(result.ordersAccepted).toBe(1);
        expect(result.ordersRejected).toBe(0);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SATISFIED',
            actualAmountCents: 0,
            varianceAmountCents: 0,
            orderId: 'order-1',
            clientId: 'client-1',
          })
        );

        expect(storage.updateOrder).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({
            paymentStatus: 'PAID',
            jobStatus: 'COMPLETED',
            approvalStatus: 'APPROVED',
          })
        );

        expect(storage.setPayrollReady).toHaveBeenCalledWith('order-1', 'AR_SATISFIED');
      });

      it('does not create variance (varianceAmountCents=0)', async () => {
        const order = makeOrder();
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        const arCall = (storage.createArExpectation as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arCall.varianceAmountCents).toBe(0);
        expect(arCall.actualAmountCents).toBe(0);
      });
    });

    describe('with amounts (totalPaidCents>0)', () => {
      it('creates SATISFIED AR when paid >= expected', async () => {
        const order = makeOrder({ baseCommissionEarned: '50.00' });
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 5000 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(result.arCreated).toBe(1);
        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SATISFIED',
            actualAmountCents: 5000,
            expectedAmountCents: 5000,
            varianceAmountCents: 0,
          })
        );
        expect(storage.updateOrder).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({ paymentStatus: 'PAID' })
        );
      });

      it('creates PARTIAL AR when paid < expected', async () => {
        const order = makeOrder({ baseCommissionEarned: '100.00' });
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 5000 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn().mockResolvedValue(order),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'PARTIAL',
            actualAmountCents: 5000,
            expectedAmountCents: 10000,
            varianceAmountCents: -5000,
          })
        );
        expect(storage.updateOrder).not.toHaveBeenCalled();
      });

      it('creates SATISFIED AR with positive variance when overpaid', async () => {
        const order = makeOrder({ baseCommissionEarned: '50.00' });
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 7500 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SATISFIED',
            actualAmountCents: 7500,
            expectedAmountCents: 5000,
            varianceAmountCents: 2500,
          })
        );
      });

      it('calculates expectedCents from base + incentive + override', async () => {
        const order = makeOrder({
          baseCommissionEarned: '100.00',
          incentiveEarned: '25.00',
          overrideDeduction: '-10.00',
        });
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 11500 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            expectedAmountCents: 11500,
          })
        );
      });
    });
  });

  describe('multi-service split path', () => {
    const multiOrder = makeOrder({
      tvSold: true,
      baseCommissionEarned: '200.00',
      installDate: '2025-01-10',
      tvInstallDate: '2025-01-12',
    });

    const lineItems = [
      { serviceCategory: 'INTERNET', totalAmount: '120.00' },
      { serviceCategory: 'VIDEO', totalAmount: '80.00' },
    ];

    describe('without amounts (totalPaidCents=0)', () => {
      it('creates SATISFIED AR for each service with zero variance', async () => {
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
        const createdArs: any[] = [];
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(multiOrder)
            .mockResolvedValueOnce({ ...multiOrder, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              { status: 'SATISFIED' },
              { status: 'SATISFIED' },
            ]),
          getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(lineItems),
          createArExpectation: vi.fn().mockImplementation((data: any) => {
            createdArs.push(data);
            return Promise.resolve({ id: `ar-${createdArs.length}` });
          }),
        });

        const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(result.arCreated).toBe(2);
        expect(createdArs).toHaveLength(2);

        expect(createdArs[0]).toEqual(expect.objectContaining({
          serviceType: 'INTERNET',
          status: 'SATISFIED',
          actualAmountCents: 0,
          varianceAmountCents: 0,
        }));
        expect(createdArs[1]).toEqual(expect.objectContaining({
          serviceType: 'VIDEO',
          status: 'SATISFIED',
          actualAmountCents: 0,
          varianceAmountCents: 0,
        }));

        expect(storage.updateOrder).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({ paymentStatus: 'PAID' })
        );
      });
    });

    describe('with amounts (totalPaidCents>0)', () => {
      it('allocates payment across services sequentially', async () => {
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 15000 });
        const createdArs: any[] = [];
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(multiOrder)
            .mockResolvedValueOnce({ ...multiOrder, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              { status: 'SATISFIED' },
              { status: 'PARTIAL' },
            ]),
          getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(lineItems),
          createArExpectation: vi.fn().mockImplementation((data: any) => {
            createdArs.push(data);
            return Promise.resolve({ id: `ar-${createdArs.length}` });
          }),
        });

        const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(result.arCreated).toBe(2);

        expect(createdArs[0]).toEqual(expect.objectContaining({
          serviceType: 'INTERNET',
          expectedAmountCents: 12000,
          actualAmountCents: 12000,
          status: 'SATISFIED',
        }));
        expect(createdArs[1]).toEqual(expect.objectContaining({
          serviceType: 'VIDEO',
          expectedAmountCents: 8000,
          actualAmountCents: 3000,
          status: 'PARTIAL',
        }));

        expect(storage.updateOrder).not.toHaveBeenCalled();
      });

      it('marks order PAID when all services SATISFIED', async () => {
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 25000 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(multiOrder)
            .mockResolvedValueOnce({ ...multiOrder, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              { status: 'SATISFIED' },
              { status: 'SATISFIED' },
            ]),
          getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(lineItems),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.updateOrder).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({ paymentStatus: 'PAID' })
        );
        expect(storage.setPayrollReady).toHaveBeenCalledWith('order-1', 'AR_SATISFIED');
      });
    });
  });

  describe('single-service fallback path (multi-service flag but no video/mobile line items)', () => {
    const fallbackOrder = makeOrder({
      tvSold: true,
      baseCommissionEarned: '100.00',
    });

    const internetOnlyLineItems = [
      { serviceCategory: 'INTERNET', totalAmount: '100.00' },
    ];

    describe('without amounts (totalPaidCents=0)', () => {
      it('creates SATISFIED AR with zero variance', async () => {
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(fallbackOrder)
            .mockResolvedValueOnce({ ...fallbackOrder, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
          getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(internetOnlyLineItems),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SATISFIED',
            actualAmountCents: 0,
            varianceAmountCents: 0,
          })
        );
        expect(storage.updateOrder).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({ paymentStatus: 'PAID' })
        );
      });
    });

    describe('with amounts (totalPaidCents>0)', () => {
      it('uses variance/partial/satisfied logic', async () => {
        const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 5000 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn().mockResolvedValue(fallbackOrder),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
          getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(internetOnlyLineItems),
        });

        await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(storage.createArExpectation).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'PARTIAL',
            actualAmountCents: 5000,
            expectedAmountCents: 10000,
            varianceAmountCents: -5000,
          })
        );
        expect(storage.updateOrder).not.toHaveBeenCalled();
      });
    });
  });

  describe('multi-service with mobile', () => {
    it('creates AR for internet and mobile services', async () => {
      const mobileOrder = makeOrder({
        mobileSold: true,
        baseCommissionEarned: '150.00',
        mobileInstallDate: '2025-01-15',
      });

      const mobileLineItems = [
        { serviceCategory: 'INTERNET', totalAmount: '100.00' },
        { serviceCategory: 'MOBILE', totalAmount: '50.00' },
      ];

      const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
      const createdArs: any[] = [];
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
        getOrderById: vi.fn()
          .mockResolvedValueOnce(mobileOrder)
          .mockResolvedValueOnce({ ...mobileOrder, approvalStatus: 'APPROVED' }),
        getArExpectationsByOrderId: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { status: 'SATISFIED' },
            { status: 'SATISFIED' },
          ]),
        getCommissionLineItemsByOrderId: vi.fn().mockResolvedValue(mobileLineItems),
        createArExpectation: vi.fn().mockImplementation((data: any) => {
          createdArs.push(data);
          return Promise.resolve({ id: `ar-${createdArs.length}` });
        }),
      });

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(createdArs).toHaveLength(2);
      expect(createdArs[0].serviceType).toBe('INTERNET');
      expect(createdArs[0].status).toBe('SATISFIED');
      expect(createdArs[1].serviceType).toBe('MOBILE');
      expect(createdArs[1].status).toBe('SATISFIED');
      expect(createdArs[1].serviceInstallDate).toBe('2025-01-15');
    });
  });

  describe('rejected orders', () => {
    it('marks order as REJECTED and does not create AR', async () => {
      const row = makeRow({ matchedOrderId: 'order-1', clientStatus: 'REJECTED' });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.ordersRejected).toBe(1);
      expect(result.ordersAccepted).toBe(0);
      expect(result.arCreated).toBe(0);
      expect(storage.setOrderClientAcceptance).toHaveBeenCalledWith('order-1', 'REJECTED');
      expect(storage.createArExpectation).not.toHaveBeenCalled();
    });
  });

  describe('duplicate and unmatched rows', () => {
    it('skips duplicate rows', async () => {
      const row = makeRow({ matchedOrderId: 'order-1', isDuplicate: true });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.arCreated).toBe(0);
      expect(result.ordersAccepted).toBe(0);
    });

    it('skips unmatched rows', async () => {
      const row = makeRow({ matchedOrderId: 'order-1', matchStatus: 'UNMATCHED' });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.arCreated).toBe(0);
    });
  });

  describe('existing ARs', () => {
    it('does not create new AR if order already has AR expectations', async () => {
      const order = makeOrder();
      const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 5000 });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
        getOrderById: vi.fn().mockResolvedValue(order),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([{ id: 'existing-ar' }]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.ordersAccepted).toBe(1);
      expect(result.arCreated).toBe(0);
      expect(storage.createArExpectation).not.toHaveBeenCalled();
    });
  });

  describe('audit logging', () => {
    it('creates audit log with correct action for manual post', async () => {
      const storage = createMockStorage();

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(storage.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'finance_import_posted',
          userId: USER_ID,
        })
      );
    });

    it('creates audit log with correct action for auto post', async () => {
      const storage = createMockStorage();

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, true, storage);

      expect(storage.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'finance_import_auto_posted',
        })
      );
    });

    it('updates import status to POSTED', async () => {
      const storage = createMockStorage();

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(storage.updateFinanceImport).toHaveBeenCalledWith(IMPORT_ID, { status: 'POSTED' });
    });
  });

  describe('payroll readiness', () => {
    it('does not set payroll ready if order is payroll held', async () => {
      const order = makeOrder({ isPayrollHeld: true });
      const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
        getOrderById: vi.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED', isPayrollHeld: true }),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
      });

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(storage.setPayrollReady).not.toHaveBeenCalled();
    });

    it('does not set payroll ready if already set', async () => {
      const order = makeOrder({ payrollReadyAt: new Date() });
      const row = makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
        getOrderById: vi.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED', payrollReadyAt: new Date() }),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
      });

      await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(storage.setPayrollReady).not.toHaveBeenCalled();
    });
  });

  describe('multiple orders in single import', () => {
    it('processes multiple orders independently', async () => {
      const order1 = makeOrder({ id: 'order-1', baseCommissionEarned: '50.00' });
      const order2 = makeOrder({ id: 'order-2', baseCommissionEarned: '75.00' });

      const rows = [
        makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 }),
        makeRow({ matchedOrderId: 'order-2', paidAmountCents: 7500 }),
      ];

      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue(rows),
        getOrderById: vi.fn().mockImplementation((id: string) => {
          if (id === 'order-1') return Promise.resolve(order1);
          if (id === 'order-2') return Promise.resolve(order2);
          return Promise.resolve(null);
        }),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.ordersAccepted).toBe(2);
      expect(result.arCreated).toBe(2);

      const calls = (storage.createArExpectation as ReturnType<typeof vi.fn>).mock.calls;
      const order1Ar = calls.find((c: any) => c[0].orderId === 'order-1')[0];
      const order2Ar = calls.find((c: any) => c[0].orderId === 'order-2')[0];

      expect(order1Ar.status).toBe('SATISFIED');
      expect(order1Ar.actualAmountCents).toBe(0);

      expect(order2Ar.status).toBe('SATISFIED');
      expect(order2Ar.actualAmountCents).toBe(7500);
    });
  });

  describe('client status variations', () => {
    it.each(['ENROLLED', 'ACCEPTED', 'COMPLETED', 'ACTIVE'])(
      'treats %s as enrolled status',
      async (status) => {
        const order = makeOrder();
        const row = makeRow({ matchedOrderId: 'order-1', clientStatus: status, paidAmountCents: 0 });
        const storage = createMockStorage({
          getFinanceImportRows: vi.fn().mockResolvedValue([row]),
          getOrderById: vi.fn()
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
          getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
        });

        const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

        expect(result.ordersAccepted).toBe(1);
        expect(result.arCreated).toBe(1);
      }
    );

    it('handles case-insensitive status matching', async () => {
      const order = makeOrder();
      const row = makeRow({ matchedOrderId: 'order-1', clientStatus: 'enrolled', paidAmountCents: 0 });
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue([row]),
        getOrderById: vi.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.ordersAccepted).toBe(1);
    });
  });

  describe('orderRowGroups returned for variance processing', () => {
    it('returns orderRowGroups with matched non-duplicate rows', async () => {
      const rows = [
        makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0 }),
        makeRow({ matchedOrderId: 'order-1', paidAmountCents: 0, isDuplicate: true }),
      ];

      const order = makeOrder();
      const storage = createMockStorage({
        getFinanceImportRows: vi.fn().mockResolvedValue(rows),
        getOrderById: vi.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({ ...order, approvalStatus: 'APPROVED' }),
        getArExpectationsByOrderId: vi.fn().mockResolvedValue([]),
      });

      const result = await executeFinanceImportPost(IMPORT_ID, FINANCE_IMPORT, USER_ID, false, storage);

      expect(result.orderRowGroups['order-1']).toHaveLength(1);
    });
  });
});

describe('evaluateVarianceExceptions', () => {
  const IMPORT_ID = 'import-1';
  const DEFAULT_THRESHOLD_PCT = 5;
  const DEFAULT_THRESHOLD_CENTS = 1000;

  function createVarianceDeps(overrides: Partial<VarianceExceptionDeps> = {}): VarianceExceptionDeps {
    return {
      getOrderById: vi.fn().mockResolvedValue({ invoiceNumber: 'INV-001', customerName: 'Test Customer' }),
      insertException: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function makeArRow(overrides: Partial<ArRow> = {}): ArRow {
    return {
      id: 'ar-1',
      clientId: 'client-1',
      orderId: 'order-1',
      expectedAmountCents: 10000,
      actualAmountCents: 10000,
      varianceAmountCents: 0,
      serviceType: null,
      ...overrides,
    };
  }

  describe('no-amount imports (zero-paid orders)', () => {
    it('does not create PAYMENT_VARIANCE exceptions when totalPaidCents=0', async () => {
      const orderRowGroups = {
        'order-1': [
          { clientStatus: 'ENROLLED', paidAmountCents: 0, matchStatus: 'MATCHED', matchedOrderId: 'order-1' },
        ],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: 0, actualAmountCents: 0 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(deps.insertException).not.toHaveBeenCalled();
      expect(result.exceptionsCreated).toBe(0);
      expect(result.skippedZeroVariance).toBe(1);
    });

    it('skips no-amount orders even if AR has non-zero variance from other data', async () => {
      const orderRowGroups = {
        'order-1': [
          { clientStatus: 'ENROLLED', paidAmountCents: 0 },
        ],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -5000, expectedAmountCents: 10000, actualAmountCents: 5000 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(deps.insertException).not.toHaveBeenCalled();
      expect(result.skippedNoAmount).toBe(1);
    });
  });

  describe('with-amount imports (non-zero paid)', () => {
    it('creates PAYMENT_VARIANCE exception when variance exceeds threshold', async () => {
      const orderRowGroups = {
        'order-1': [
          { clientStatus: 'ENROLLED', paidAmountCents: 8500 },
        ],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -1500, expectedAmountCents: 10000, actualAmountCents: 8500 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(result.exceptionsCreated).toBe(1);
      expect(deps.insertException).toHaveBeenCalledWith(
        expect.objectContaining({
          exceptionType: 'PAYMENT_VARIANCE',
          severity: 'WARNING',
          relatedEntityId: 'ar-1',
          relatedEntityType: 'ar_expectation',
          status: 'OPEN',
        })
      );
    });

    it('creates HIGH severity exception for large variance (>=$100 or >=20%)', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 5000 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ id: 'ar-big', orderId: 'order-1', varianceAmountCents: -15000, expectedAmountCents: 20000, actualAmountCents: 5000 }),
      ];

      const deps = createVarianceDeps();

      await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(deps.insertException).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'HIGH' })
      );
    });

    it('includes underpaid direction in title for negative variance', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 5000 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -5000, expectedAmountCents: 10000, actualAmountCents: 5000 }),
      ];

      const deps = createVarianceDeps();

      await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      const call = (deps.insertException as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.title).toContain('underpaid');
    });

    it('includes overpaid direction in title for positive variance', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 15000 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: 5000, expectedAmountCents: 10000, actualAmountCents: 15000 }),
      ];

      const deps = createVarianceDeps();

      await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      const call = (deps.insertException as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.title).toContain('overpaid');
    });
  });

  describe('threshold filtering', () => {
    it('skips variance below both pct and cents thresholds', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 9800 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -200, expectedAmountCents: 10000, actualAmountCents: 9800 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), 5, 1000, deps
      );

      expect(deps.insertException).not.toHaveBeenCalled();
      expect(result.skippedBelowThreshold).toBe(1);
    });

    it('creates exception when variance exceeds pct threshold even if below cents threshold', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 800 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -200, expectedAmountCents: 1000, actualAmountCents: 800 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), 5, 500, deps
      );

      expect(result.exceptionsCreated).toBe(1);
    });
  });

  describe('duplicate exception prevention', () => {
    it('skips AR rows that already have existing exceptions', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 5000 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ id: 'ar-existing', orderId: 'order-1', varianceAmountCents: -5000 }),
      ];

      const existingEntityIds = new Set<string | null>(['ar-existing']);
      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, existingEntityIds, DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(deps.insertException).not.toHaveBeenCalled();
      expect(result.skippedExisting).toBe(1);
    });
  });

  describe('mixed orders scenario', () => {
    it('creates exceptions only for non-zero-amount orders with variance', async () => {
      const orderRowGroups = {
        'order-no-amount': [
          { clientStatus: 'ENROLLED', paidAmountCents: 0 },
        ],
        'order-with-amount': [
          { clientStatus: 'ENROLLED', paidAmountCents: 5000 },
        ],
      };

      const arRows: ArRow[] = [
        makeArRow({ id: 'ar-no-amt', orderId: 'order-no-amount', varianceAmountCents: 0, actualAmountCents: 0 }),
        makeArRow({ id: 'ar-with-amt', orderId: 'order-with-amount', varianceAmountCents: -5000, expectedAmountCents: 10000, actualAmountCents: 5000 }),
      ];

      const deps = createVarianceDeps();

      const result = await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      expect(result.exceptionsCreated).toBe(1);
      expect(deps.insertException).toHaveBeenCalledTimes(1);
      expect(deps.insertException).toHaveBeenCalledWith(
        expect.objectContaining({ relatedEntityId: 'ar-with-amt' })
      );
    });
  });

  describe('detail string formatting', () => {
    it('includes import id, invoice, customer, and amounts in detail', async () => {
      const orderRowGroups = {
        'order-1': [{ clientStatus: 'ENROLLED', paidAmountCents: 5000 }],
      };

      const arRows: ArRow[] = [
        makeArRow({ orderId: 'order-1', varianceAmountCents: -5000, expectedAmountCents: 10000, actualAmountCents: 5000, serviceType: 'INTERNET' }),
      ];

      const deps = createVarianceDeps({
        getOrderById: vi.fn().mockResolvedValue({ invoiceNumber: 'INV-123', customerName: 'John Doe' }),
      });

      await evaluateVarianceExceptions(
        IMPORT_ID, orderRowGroups, arRows, new Set(), DEFAULT_THRESHOLD_PCT, DEFAULT_THRESHOLD_CENTS, deps
      );

      const call = (deps.insertException as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.detail).toContain('Import: import-1');
      expect(call.detail).toContain('Invoice: INV-123');
      expect(call.detail).toContain('Customer: John Doe');
      expect(call.detail).toContain('Service: INTERNET');
      expect(call.detail).toContain('Expected: $100.00');
      expect(call.detail).toContain('Actual: $50.00');
    });
  });
});
