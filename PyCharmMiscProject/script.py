import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import os, tempfile, csv, sys
import time

sys.setrecursionlimit(2000)

# Check for cupy availability
try:
    import cupy as cp

    GPU_AVAILABLE = True
except Exception as e:
    print(f"GPU not available: {e}")
    cp = None
    GPU_AVAILABLE = False

if GPU_AVAILABLE:
    print("Testing CuPy:", cp.__version__)
    test_array = cp.array([1, 2, 3])
    print("CuPy test array:", test_array)
else:
    print("CuPy not available, falling back to NumPy.")

# Simulate ternary and bipolar logic operations for a ternary AI chip
# Ternary values: -1 (negative), 0 (neutral), +1 (positive)
# Bipolar values: -1 (negative), +1 (positive), 0 (neutral)

# ----------------------------
# Logic gates
# ----------------------------
def ternary_and(a, b):
    """Ternary AND: Returns min of two ternary values {-1, 0, 1}"""
    return np.min(a, b)


def ternary_or(a, b):
    """Ternary OR: Returns max of two ternary values {-1, 0, 1}"""
    return np.max(a, b)


def ternary_not(a):
    """Ternary NOT: Inverts -1 to +1, +1 to -1, 0 stays 0"""
    return -a

# ----------------------------
# Neural operations
# ----------------------------
def to_ternary_array_gpu(x, t_low=-0.5, t_high=0.5):
    return cp.where(x >= t_high, 1, cp.where(x <= t_low, -1, 0))

def to_ternary_array(x, t_low=-0.5, t_high=0.5):
    """Convert continuous values to ternary (-1, 0, +1) based on thresholds."""
    x = np.array(x)
    return np.where(x >= t_high, 1, np.where(x <= t_low, -1, 0))


def transition_energy_per_neuron(prev, curr, dynamic=False, energy_scale=1.0):
    """Calculate energy cost per neuron transition."""
    energy_map = {}
    for a in [-1, 0, 1]:
        for b in [-1, 0, 1]:
            if a == b:
                energy_map[(a, b)] = 0.1 * energy_scale
            elif a == 0 or b == 0:
                energy_map[(a, b)] = 1.0 * energy_scale
            else:
                energy_map[(a, b)] = 5.0 * energy_scale
    prev = np.array(prev, dtype=int).flatten()
    curr = np.array(curr, dtype=int).flatten()
    energies = [energy_map[(int(p), int(c))] for p, c in zip(prev, curr)]
    if dynamic:
        energies = [e * abs(p - c) for e, p, c in zip(energies, prev, curr)]
    return energies


def ternary_layer_numpy(inputs, weights, biases=None, add_noise=False, sigma=0.05, t_low=-0.5, t_high=0.5,
                        mode="ternary"):
    """
    Vectorized layer computation for ternary or bipolar logic.

    Args:
        inputs: Input vector (numpy array of -1, 0, +1 or continuous values)
        weights: 2D array (num_neurons x num_inputs) of weights (-1, 0, +1)
        biases: 1D array of biases (optional, defaults to zeros)
        add_noise: Whether to add Gaussian noise (default False)
        sigma: Standard deviation of noise (default 0.05)
        t_low: Lower threshold for ternary mapping (default -0.5)
        t_high: Upper threshold for ternary mapping (default 0.5)
        mode: "ternary" or "bipolar" (default "ternary")

    Returns:
        numpy array of layer outputs (-1, 0, +1 for ternary; -1, 0, +1 for bipolar)
    """
    inputs = np.array(inputs, dtype=float)
    weights = np.array(weights, dtype=float)
    if biases is None:
        biases = np.zeros(weights.shape[0], dtype=float)
    else:
        biases = np.array(biases, dtype=float)

    inputs_copy = inputs.copy()
    weights_copy = weights.copy()
    if add_noise:
        weights_copy += np.random.normal(0, sigma, size=weights_copy.shape)
        inputs_copy += np.random.normal(0, sigma, size=inputs_copy.shape)

    result = np.dot(weights_copy, inputs_copy) + biases

    if mode == "bipolar":
        outputs = np.sign(result)
        outputs[result == 0] = 0  # Ensure 0 stays neutral
    else:  # ternary
        outputs = to_ternary_array(result, t_low, t_high)

    return outputs

# ----------------------------
# Multi-layer network with trace, energy, and animation
# ----------------------------
class TernaryNN:
    def __init__(self, layer_configs, t_low=-0.5, t_high=0.5, mode="ternary"):
        """
        layer_configs: list of dicts, each with:
            - "weights": 2D numpy array (num_neurons x num_inputs)
            - "biases": 1D numpy array (optional)
        mode: "ternary" or "bipolar" for layer processing
        """
        self.layers = layer_configs
        self.t_low = t_low
        self.t_high = t_high
        self.mode = mode

    def forward(self, inputs, trace=False):
        """Run inputs through all layers sequentially, tracking energy."""
        activations = inputs
        all_activations = [activations.copy()]  # Store input as layer 0
        per_neuron_energy = []
        if trace:
            print("Input:", activations)

        prev = activations
        for idx, layer in enumerate(self.layers, 1):
            W = layer["weights"]
            b = layer.get("biases", None)
            activations = ternary_layer_numpy(prev, W, b, add_noise=True, mode=self.mode)
            energies = transition_energy_per_neuron(prev, activations, dynamic=True)
            per_neuron_energy.append(energies)
            all_activations.append(activations.copy())
            if trace:
                print(f"Layer {idx} activations: {activations}")
            prev = activations

        return activations, all_activations, per_neuron_energy

    def animate(self, all_activations, per_neuron_energy, interval=1000, mode=""):
        """
        Animate activations and energy as a heatmap, updating layer by layer.
        interval: time per frame in ms
        """
        max_neurons = max(len(act) for act in all_activations)
        num_layers = len(all_activations)

        # Pad activations into matrix
        activ_matrix = np.full((max_neurons, num_layers), np.nan)
        for i, act in enumerate(all_activations):
            activ_matrix[:len(act), i] = act

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6, 8), gridspec_kw={'height_ratios': [2, 1]})
        cmap = plt.cm.get_cmap("RdYlGn", 3)
        cax1 = ax1.imshow(np.full_like(activ_matrix, np.nan), cmap=cmap, vmin=-1, vmax=1, aspect="auto")
        ax1.set_xticks(range(num_layers))
        ax1.set_xticklabels([f"Layer {i}" for i in range(num_layers)])
        ax1.set_yticks(range(max_neurons))
        ax1.set_yticklabels([f"N{j}" for j in range(max_neurons)])
        plt.colorbar(cax1, ax=ax1, ticks=[-1, 0, 1], label="State")
        ax1.set_title(f"{mode} Activations (animated)")
        ax1.set_xlabel("Layers")
        ax1.set_ylabel("Neurons")

        # Energy heatmap
        energy_matrix = np.full((max_neurons, num_layers - 1), np.nan)
        for i, energy in enumerate(per_neuron_energy):
            energy_matrix[:len(energy), i] = energy
        cax2 = ax2.imshow(np.full_like(energy_matrix, np.nan), cmap="hot", vmin=0, vmax=5, aspect="auto")
        ax2.set_xticks(range(num_layers - 1))
        ax2.set_xticklabels([f"L{i} to L{i + 1}" for i in range(num_layers - 1)])
        ax2.set_yticks(range(max_neurons))
        ax2.set_yticklabels([f"N{j}" for j in range(max_neurons)])
        plt.colorbar(cax2, ax=ax2, label="Energy")
        ax2.set_title(f"{mode} Transition Energy")
        ax2.set_xlabel("Layer Transitions")
        ax2.set_ylabel("Neurons")

        def update(frame):
            disp_act = np.full_like(activ_matrix, np.nan)
            disp_act[:, :frame + 1] = activ_matrix[:, :frame + 1]
            cax1.set_data(disp_act)
            if frame > 0:
                disp_ener = np.full_like(energy_matrix, np.nan)
                disp_ener[:, :frame] = energy_matrix[:, :frame]
                cax2.set_data(disp_ener)
            return [cax1, cax2]

        ani = animation.FuncAnimation(fig, update, frames=num_layers, interval=interval, blit=False, repeat=False)
        plt.tight_layout()
        plt.show()


# ----------------------------
# Simulation and export
# ----------------------------
def run_forward_numpy(input_vec, layers, add_noise=False, mode="ternary"):
    nn = TernaryNN(layers, mode=mode)
    activations, all_activations, energies = nn.forward(input_vec, trace=False)
    return activations, all_activations, energies

def run_forward_gpu_like(input_vec, layers, add_noise=False, mode="ternary"):
    if GPU_AVAILABLE:
        try:
            x = cp.array(input_vec)
            acts = [cp.asnumpy(x)]
            ener = []
            prev = x
            start = time.time()
            #run_forward_gpu_like(input_vector, layers, mode="ternary")
            print("GPU sim time:", time.time() - start)
            for layer in layers:
                W = cp.array(layer["weights"])
                b = cp.array(layer.get("biases", np.zeros(W.shape[0])))
                if add_noise:
                    W = W + cp.random.normal(0, 0.05, size=W.shape)
                    prev = prev + cp.random.normal(0, 0.05, size=prev.shape)
                result = cp.dot(prev, W.T) + b
                if mode == "bipolar":
                    mapped = cp.sign(result)
                    mapped[result == 0] = 0
                else:  # ternary
                   # mapped = cp.asnumpy(to_ternary_array(cp.asnumpy(result)))
                    mapped = to_ternary_array_gpu(result)
                acts.append(mapped)
                ener.append(transition_energy_per_neuron(cp.asnumpy(prev), mapped, dynamic=True))
                prev = cp.array(mapped)
            return acts[1:], acts, ener
        except Exception as e:
            print(f"GPU error: {e}. Falling back to CPU.")
            return run_forward_numpy(input_vec, layers, add_noise, mode)
    else:
        return run_forward_numpy(input_vec, layers, add_noise, mode)

def create_mp4_from_activations(activations, per_neuron_energy, filename, mode):
    max_neurons = max(len(a) for a in activations)
    activ_matrix = np.full((max_neurons, len(activations) + 1), np.nan)
    for i, act in enumerate(activations):
        activ_matrix[:len(act), i + 1] = act
    activ_matrix[:len(activations[0]), 0] = activations[0]  # Include input layer

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6, 8), gridspec_kw={'height_ratios': [2, 1]})
    cmap = plt.cm.get_cmap("RdYlGn", 3)
    cax1 = ax1.imshow(np.full_like(activ_matrix, np.nan), cmap=cmap, vmin=-1, vmax=1, aspect="auto")
    ax1.set_xticks(range(len(activations) + 1))
    ax1.set_xticklabels([f"Layer {i}" for i in range(len(activations) + 1)])
    ax1.set_yticks(range(max_neurons))
    ax1.set_yticklabels([f"N{j}" for j in range(max_neurons)])
    plt.colorbar(cax1, ax=ax1, ticks=[-1, 0, 1], label="State")
    ax1.set_title(f"{mode} Activations (animated)")
    ax1.set_xlabel("Layers")
    ax1.set_ylabel("Neurons")

    energy_matrix = np.full((max_neurons, len(per_neuron_energy)), np.nan)
    for i, energy in enumerate(per_neuron_energy):
        energy_matrix[:len(energy), i] = energy
    cax2 = ax2.imshow(np.full_like(energy_matrix, np.nan), cmap="hot", vmin=0, vmax=5, aspect="auto")
    ax2.set_xticks(range(len(per_neuron_energy)))
    ax2.set_xticklabels([f"L{i} to L{i + 1}" for i in range(len(per_neuron_energy))])
    ax2.set_yticks(range(max_neurons))
    ax2.set_yticklabels([f"N{j}" for j in range(max_neurons)])
    plt.colorbar(cax2, ax=ax2, label="Energy")
    ax2.set_title(f"{mode} Transition Energy")
    ax2.set_xlabel("Layer Transitions")
    ax2.set_ylabel("Neurons")

    def update(frame):
        disp_act = np.full_like(activ_matrix, np.nan)
        disp_act[:, :frame + 1] = activ_matrix[:, :frame + 1]
        cax1.set_data(disp_act)
        if frame > 0:
            disp_ener = np.full_like(energy_matrix, np.nan)
            disp_ener[:, :frame] = energy_matrix[:, :frame]
            cax2.set_data(disp_ener)
        return [cax1, cax2]

    ani = animation.FuncAnimation(fig, update, frames=len(activations) + 1, interval=600, blit=False, repeat=False)
    mp4_path = filename
    Writer = animation.writers['ffmpeg']
    writer = Writer(fps=1.5, metadata=dict(artist='Grok'), bitrate=3000)
    ani.save(mp4_path, writer=writer)
    plt.close(fig)
    return mp4_path

# ----------------------------
# Example usage
# ----------------------------
if __name__ == "__main__":
    # Example inputs and weights
    np.random.seed(123)
    input_vector = np.random.choice([-1, 0, 1], size=8, p=[0.3, 0.2, 0.5])
    bipolar_input = np.random.choice([-1, 1], size=8, p=[0.5, 0.5])
    layer1 = {
        "weights": np.random.choice([-1, 0, 1], size=(8, 8), p=[0.3, 0.4, 0.3]).astype(float),
        "biases": np.random.randint(-1, 2, size=8).astype(float)
    }
    layer2 = {
        "weights": np.random.choice([-1, 0, 1], size=(6, 8), p=[0.3, 0.4, 0.3]).astype(float),
        "biases": np.random.randint(-1, 2, size=6).astype(float)
    }
    layer3 = {
        "weights": np.random.choice([-1, 0, 1], size=(4, 6), p=[0.3, 0.4, 0.3]).astype(float),
        "biases": np.random.randint(-1, 2, size=4).astype(float)
    }
    layers = [layer1, layer2, layer3]

    # Run simulations
    activations_cpu_ternary, all_acts_cpu_ternary, energies_cpu_ternary = run_forward_numpy(input_vector, layers,
                                                                                            mode="ternary")
    activations_gpu_ternary, all_acts_gpu_ternary, energies_gpu_ternary = run_forward_gpu_like(input_vector, layers,
                                                                                               mode="ternary")
    activations_cpu_bipolar, all_acts_cpu_bipolar, energies_cpu_bipolar = run_forward_numpy(bipolar_input, layers,
                                                                                            mode="bipolar")
    activations_gpu_bipolar, all_acts_gpu_bipolar, energies_gpu_bipolar = run_forward_gpu_like(bipolar_input, layers,
                                                                                               mode="bipolar")

    # Save outputs
    tmpdir = tempfile.mkdtemp()
    csv_path = os.path.join(tmpdir, "per_neuron_energy.csv")
    with open(csv_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        header = []
        for li in range(len(all_acts_cpu_ternary) - 1):
            next_activations = all_acts_cpu_ternary[li + 1]
            next_size = len(next_activations) if hasattr(next_activations, '__len__') else 1
            for nj in range(next_size):
                header.append(f"Trans_L{li}_to_L{li + 1}_N{nj}")
        writer.writerow(["Run", "Mode"] + header)
        row = ["run1", "CPU_Ternary"]
        for energies in energies_cpu_ternary:
            row.extend(energies)
        writer.writerow(row)
        row = ["run1", "GPU_Ternary"]
        for energies in energies_gpu_ternary:
            row.extend(energies)
        writer.writerow(row)
        row = ["run1", "CPU_Bipolar"]
        for energies in energies_cpu_bipolar:
            row.extend(energies)
        writer.writerow(row)
        row = ["run1", "GPU_Bipolar"]
        for energies in energies_gpu_bipolar:
            row.extend(energies)
        writer.writerow(row)

    # Create animations

    mp4_cpu_ternary = os.path.join(tmpdir, "activations_cpu_ternary.mp4")
    mp4_gpu_ternary = os.path.join(tmpdir, "activations_gpu_ternary.mp4")
    mp4_cpu_bipolar = os.path.join(tmpdir, "activations_cpu_bipolar.mp4")
    mp4_gpu_bipolar = os.path.join(tmpdir, "activations_gpu_bipolar.mp4")
    create_mp4_from_activations(activations_cpu_ternary, energies_cpu_ternary, mp4_cpu_ternary, "CPU_Ternary")
    create_mp4_from_activations(activations_gpu_ternary, energies_gpu_ternary, mp4_gpu_ternary, "GPU_Ternary")
    create_mp4_from_activations(activations_cpu_bipolar, energies_cpu_bipolar, mp4_cpu_bipolar, "CPU_Bipolar")
    create_mp4_from_activations(activations_gpu_bipolar, energies_gpu_bipolar, mp4_gpu_bipolar, "GPU_Bipolar")


    print("activations_cpu_ternary:", activations_cpu_ternary)
    print("Type of first element:", type(activations_cpu_ternary[0]))

    print("Done. Outputs saved to:", tmpdir)
    print(os.listdir(tmpdir))

    result = {"tmpdir": tmpdir, "csv": csv_path, "mp4_cpu_ternary": mp4_cpu_ternary, "mp4_gpu_ternary": mp4_gpu_ternary,
              "mp4_cpu_bipolar": mp4_cpu_bipolar, "mp4_gpu_bipolar": mp4_gpu_bipolar}

    result = {"tmpdir": tmpdir, "csv": csv_path}
    print(result)