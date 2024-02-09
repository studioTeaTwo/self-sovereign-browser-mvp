const isEnabled = async (message, sender) => {
  return {
    data: { isEnabled: true },
  }
}

export default isEnabled
