import { BlingAuthController } from '../src/bling/bling-auth.controller';

describe('BlingAuthController callback', () => {
  const response = () => {
    const res = {
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn()
    };
    res.status.mockReturnValue(res);
    res.type.mockReturnValue(res);
    res.send.mockReturnValue(res);
    return res;
  };

  it('exchanges the authorization code and redirects immediately to accounts', async () => {
    const auth = { exchangeCode: jest.fn().mockResolvedValue({ id: 'bling-account' }), saveToken: jest.fn() };
    const config = { get: jest.fn((_key: string, fallback: string) => fallback) };
    const controller = new BlingAuthController(config as never, auth as never, {consume:jest.fn().mockResolvedValue('outlet4u')} as never);
    const res = response();

    await controller.callback(undefined, undefined, 'one-time-code', 'outlet4u', undefined, undefined, res as never);

    expect(auth.exchangeCode).toHaveBeenCalledWith('one-time-code', 'outlet4u');
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:4200/contas?bling=connected');
    expect(res.send).not.toHaveBeenCalled();
  });

  it('renders the OAuth error without trying to exchange a code', async () => {
    const auth = { exchangeCode: jest.fn(), saveToken: jest.fn() };
    const config = { get: jest.fn((_key: string, fallback: string) => fallback) };
    const controller = new BlingAuthController(config as never, auth as never, {consume:jest.fn().mockResolvedValue('outlet4u')} as never);
    const res = response();

    await controller.callback(undefined, undefined, undefined, 'outlet4u', 'access_denied', 'Acesso negado', res as never);

    expect(auth.exchangeCode).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:4200/contas?bling=error&message=Acesso+negado');
  });
});
