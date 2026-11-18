import { expect, test } from 'vitest'
import { cloudConfig } from './cloudConfig'

test('未設定や特権キーを拒否し、アプリ専用のセッション保存キーを使う', () => {
  const url = 'https://training.example.com'
  expect(cloudConfig(undefined, undefined)).toBeNull()
  expect(cloudConfig(url, 'sb_secret_test')).toBeNull()
  expect(cloudConfig(url, 'malformed.jwt.key')).toBeNull()
  expect(cloudConfig('http://training.example.com', 'sb_publishable_test')).toBeNull()
  expect(cloudConfig(url, 'sb_publishable_test')).toEqual({
    url, key: 'sb_publishable_test', storageKey: 'aoba-training-log-auth-training.example.com',
  })
})

